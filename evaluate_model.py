"""
Doodle Model Evaluation Script
==============================
Evaluates a trained ImprovedDoodleCNN on the validation set.
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
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, TensorDataset
from tqdm import tqdm

from model import ImprovedDoodleCNN

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
    print("Loading dataset CSV...")
    df = pd.read_csv(os.path.join(dataset_path, "master_doodle_dataframe.csv"))
    
    # Only keep recognized drawings
    df = df[df['recognized'] == True]
    
    # Filter to classes with enough samples
    class_counts = df['word'].value_counts()
    valid_classes = class_counts[class_counts >= min_samples_per_class].index.tolist()
    df = df[df['word'].isin(valid_classes)]
    
    num_classes = len(valid_classes)
    samples_per_class = max(5, num_samples // num_classes)
    
    sampled_dfs = []
    for word, group in df.groupby('word'):
        n = min(samples_per_class, len(group))
        if n < 5: continue
        sampled_dfs.append(group.sample(n=n, random_state=42))
    df_sampled = pd.concat(sampled_dfs).reset_index(drop=True)
    
    class_names = sorted(df_sampled['word'].unique().tolist())
    class_to_idx = {name: idx for idx, name in enumerate(class_names)}
    
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
    
    return X, y, class_names

@torch.no_grad()
def validate(model, loader, criterion, device):
    model.eval()
    running_loss = 0.0
    correct = 0
    total = 0
    
    for inputs, labels in tqdm(loader, desc="  Evaluating", leave=False):
        inputs = inputs.to(device, dtype=torch.float32) / 255.0
        labels = labels.to(device)
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        
        running_loss += loss.item() * inputs.size(0)
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()
    
    return running_loss / total, correct / total

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", type=str, default="doodle_cnn_improved.pth")
    parser.add_argument("--samples", type=int, default=200000)
    args = parser.parse_args()
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    
    dataset_path = kagglehub.dataset_download("ashishjangra27/doodle-dataset")
    X, y, class_names = load_and_prepare_data(dataset_path, args.samples)
    
    _, X_val, _, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    val_ds = TensorDataset(torch.tensor(X_val), torch.tensor(y_val))
    val_loader = DataLoader(val_ds, batch_size=128, shuffle=False)
    
    model = ImprovedDoodleCNN(len(class_names)).to(device)
    model.load_state_dict(torch.load(args.weights, map_location=device, weights_only=True))
    
    criterion = nn.CrossEntropyLoss()
    loss, acc = validate(model, val_loader, criterion, device)
    
    print(f"\n📊 Evaluation Results for {args.weights}:")
    print(f"   Validation Loss:     {loss:.4f}")
    print(f"   Validation Accuracy: {acc*100:.2f}%")

if __name__ == "__main__":
    main()
