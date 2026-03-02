"""
Improved Doodle CNN Training Script
====================================
Trains a CNN to classify Quick Draw doodle images.
Outputs:
  - doodle_cnn_improved.pth   (model weights)
  - class_names.txt           (ordered class labels)

Usage:
  python train_model.py                        # Full training (50k samples, 20 epochs)
  python train_model.py --samples 1000 --epochs 3  # Quick smoke test
"""

import argparse
import ast
import os

import cv2
import kagglehub
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, TensorDataset
from tqdm import tqdm

from model import ImprovedDoodleCNN


# ──────────────────────────────────────────────
#  Data Loading & Preprocessing
# ──────────────────────────────────────────────

IMG_SIZE = 64

def strokes_to_image(strokes, size=(IMG_SIZE, IMG_SIZE)):
    """Convert stroke data to a grayscale image."""
    img = np.zeros(size, dtype=np.uint8)
    for stroke in strokes:
        if len(stroke) >= 2 and len(stroke[0]) > 0:
            for i in range(len(stroke[0]) - 1):
                x1 = int(min(stroke[0][i], size[1] - 1))
                y1 = int(min(stroke[1][i], size[0] - 1))
                x2 = int(min(stroke[0][i + 1], size[1] - 1))
                y2 = int(min(stroke[1][i + 1], size[0] - 1))
                cv2.line(img, (x1, y1), (x2, y2), 255, 2)
    return img


def load_and_prepare_data(dataset_path, num_samples, min_samples_per_class=20):
    """
    Load the doodle dataset, filter to classes with enough data,
    and return stratified samples.
    """
    print("Loading dataset CSV...")
    df = pd.read_csv(os.path.join(dataset_path, "master_doodle_dataframe.csv"))
    print(f"  Total rows: {len(df)}")
    print(f"  Total classes: {df['word'].nunique()}")
    
    # Only keep recognized drawings
    df = df[df['recognized'] == True]
    
    # Filter to classes with enough samples
    class_counts = df['word'].value_counts()
    valid_classes = class_counts[class_counts >= min_samples_per_class].index.tolist()
    df = df[df['word'].isin(valid_classes)]
    
    num_classes = len(valid_classes)
    print(f"  Classes with ≥{min_samples_per_class} samples: {num_classes}")
    
    # Enforce minimum samples per class for train/val split to work
    min_needed = 5  # need at least 5 per class to have ≥1 in val set
    samples_per_class = max(min_needed, num_samples // num_classes)
    print(f"  Sampling {samples_per_class} per class ({samples_per_class * num_classes} total)...")
    
    sampled_dfs = []
    for word, group in df.groupby('word'):
        n = min(samples_per_class, len(group))
        if n < min_needed:
            continue  # skip classes without enough data
        sampled_dfs.append(group.sample(n=n, random_state=42))
    df_sampled = pd.concat(sampled_dfs).reset_index(drop=True)
    
    # Build ordered class list (sorted for determinism)
    class_names = sorted(df_sampled['word'].unique().tolist())
    class_to_idx = {name: idx for idx, name in enumerate(class_names)}
    
    # Convert strokes to images
    print(f"  Converting {len(df_sampled)} drawings to {IMG_SIZE}×{IMG_SIZE} images...")
    images = []
    labels = []
    for _, row in tqdm(df_sampled.iterrows(), total=len(df_sampled), desc="Processing"):
        try:
            strokes = ast.literal_eval(row['drawing'])
            img = strokes_to_image(strokes)
            images.append(img)
            labels.append(class_to_idx[row['word']])
        except Exception:
            continue
    
    X = np.array(images, dtype=np.uint8)
    X = X.reshape(-1, 1, IMG_SIZE, IMG_SIZE)
    y = np.array(labels, dtype=np.int64)
    
    print(f"  Final dataset: X={X.shape}, y={y.shape}, classes={len(class_names)}")
    return X, y, class_names


# ──────────────────────────────────────────────
#  Data Augmentation (applied on-the-fly via transforms on tensors)
# ──────────────────────────────────────────────

def augment_batch(images):
    """Apply simple augmentations to a batch of image tensors."""
    batch_size = images.size(0)
    augmented = images.clone()
    
    for i in range(batch_size):
        # Random rotation (-15 to +15 degrees)
        if torch.rand(1).item() > 0.5:
            angle = (torch.rand(1).item() - 0.5) * 30  # -15 to +15
            angle_rad = angle * np.pi / 180
            cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
            theta = torch.tensor([
                [cos_a, -sin_a, 0],
                [sin_a,  cos_a, 0]
            ], dtype=torch.float32).unsqueeze(0)
            grid = F.affine_grid(theta, augmented[i:i+1].size(), align_corners=False)
            augmented[i:i+1] = F.grid_sample(augmented[i:i+1], grid, align_corners=False)
        
        # Random translation (-10% to +10%)
        if torch.rand(1).item() > 0.5:
            tx = (torch.rand(1).item() - 0.5) * 0.2
            ty = (torch.rand(1).item() - 0.5) * 0.2
            theta = torch.tensor([
                [1, 0, tx],
                [0, 1, ty]
            ], dtype=torch.float32).unsqueeze(0)
            grid = F.affine_grid(theta, augmented[i:i+1].size(), align_corners=False)
            augmented[i:i+1] = F.grid_sample(augmented[i:i+1], grid, align_corners=False)
    
    return augmented


# ──────────────────────────────────────────────
#  Training & Validation
# ──────────────────────────────────────────────

def train_one_epoch(model, loader, criterion, optimizer, device, use_augmentation=True):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0
    
    for inputs, labels in tqdm(loader, desc="  Training", leave=False):
        inputs = inputs.to(device, dtype=torch.float32) / 255.0
        labels = labels.to(device)
        
        if use_augmentation:
            inputs = augment_batch(inputs)
        
        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()
        
        running_loss += loss.item() * inputs.size(0)
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()
    
    return running_loss / total, correct / total


@torch.no_grad()
def validate(model, loader, criterion, device):
    model.eval()
    running_loss = 0.0
    correct = 0
    total = 0
    
    for inputs, labels in loader:
        inputs = inputs.to(device, dtype=torch.float32) / 255.0
        labels = labels.to(device)
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        
        running_loss += loss.item() * inputs.size(0)
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()
    
    return running_loss / total, correct / total


# ──────────────────────────────────────────────
#  Main
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train Improved Doodle CNN")
    parser.add_argument("--samples", type=int, default=50000, help="Total training samples")
    parser.add_argument("--epochs", type=int, default=20, help="Max training epochs")
    parser.add_argument("--batch-size", type=int, default=64, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--patience", type=int, default=7, help="Early stopping patience")
    parser.add_argument("--output-dir", type=str, default=".", help="Output directory")
    parser.add_argument("--resume", type=str, default=None, help="Path to checkpoint to resume from")
    args = parser.parse_args()
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    
    # Download / locate dataset
    print("\n📥  Downloading dataset...")
    dataset_path = kagglehub.dataset_download("ashishjangra27/doodle-dataset")
    print(f"  Dataset path: {dataset_path}")
    
    # Load and prepare data
    print("\n📊  Preparing data...")
    X, y, class_names = load_and_prepare_data(dataset_path, args.samples)
    num_classes = len(class_names)
    
    # Train/val split (stratified when possible)
    try:
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
    except ValueError:
        print("  ⚠️  Stratified split failed, falling back to random split")
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
    print(f"  Train: {X_train.shape[0]}, Val: {X_val.shape[0]}")
    
    # DataLoaders
    train_ds = TensorDataset(torch.tensor(X_train), torch.tensor(y_train))
    val_ds = TensorDataset(torch.tensor(X_val), torch.tensor(y_val))
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)
    
    # Model
    model = ImprovedDoodleCNN(num_classes).to(device)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"\n🧠  Model: {total_params:,} parameters, {num_classes} classes")
    
    # Resume from checkpoint if specified
    if args.resume:
        print(f"  📂 Resuming from checkpoint: {args.resume}")
        state_dict = torch.load(args.resume, map_location=device, weights_only=True)
        model.load_state_dict(state_dict)
        print("  ✅ Checkpoint loaded successfully")
    
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode='min', patience=3, factor=0.5
    )
    
    # Training loop
    print(f"\n🏋️  Training for up to {args.epochs} epochs (early stopping patience={args.patience})...\n")
    best_val_acc = 0.0
    epochs_no_improve = 0
    
    for epoch in range(1, args.epochs + 1):
        train_loss, train_acc = train_one_epoch(
            model, train_loader, criterion, optimizer, device, use_augmentation=True
        )
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        
        scheduler.step(val_loss)
        
        current_lr = optimizer.param_groups[0]['lr']
        print(f"  Epoch {epoch:2d}/{args.epochs} │ "
              f"Train Loss: {train_loss:.4f}  Acc: {train_acc:.4f} │ "
              f"Val Loss: {val_loss:.4f}  Acc: {val_acc:.4f} │ "
              f"LR: {current_lr:.6f}")
        
        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            epochs_no_improve = 0
            weights_path = os.path.join(args.output_dir, "doodle_cnn_improved.pth")
            torch.save(model.state_dict(), weights_path)
            print(f"  ✅ New best val accuracy: {val_acc:.4f} — saved to {weights_path}")
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= args.patience:
                print(f"\n⏹  Early stopping triggered after {epoch} epochs (no improvement for {args.patience} epochs)")
                break
    
    # Save class names
    labels_path = os.path.join(args.output_dir, "class_names.txt")
    with open(labels_path, "w") as f:
        for name in class_names:
            f.write(name + "\n")
    print(f"\n📝  Saved {len(class_names)} class names to {labels_path}")
    
    print(f"\n🎉  Training complete! Best validation accuracy: {best_val_acc:.4f}")
    print(f"    Model weights: {os.path.join(args.output_dir, 'doodle_cnn_improved.pth')}")
    print(f"    Class names:   {labels_path}")


if __name__ == "__main__":
    main()
