import sys
import json
import torch
from torch import nn
from pathlib import Path
from PIL import Image
import torchvision.transforms as transforms
import io
import base64

import sys
import os
# Add parent directory to path so we can import model.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from model import ImprovedDoodleCNN

# ──────────────────────────────────────────────
#  Image Processing
# ──────────────────────────────────────────────

def process_image(base64_img):
    """Convert a base64-encoded canvas image to a model-ready tensor."""
    # Remove data URI prefix if present
    if ',' in base64_img:
        base64_img = base64_img.split(',')[1]
        
    # Ensure correct padding
    missing_padding = len(base64_img) % 4
    if missing_padding:
        base64_img += '=' * (4 - missing_padding)
        
    image_data = base64.b64decode(base64_img)
    image = Image.open(io.BytesIO(image_data))
    
    # Flatten RGBA onto white background
    if image.mode == 'RGBA':
        background = Image.new('RGB', image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3]) 
        image = background
        
    image = image.convert('L')
    
    # Find bounding box of drawing (non-white pixels) and crop
    from PIL import ImageChops
    bg = Image.new(image.mode, image.size, 255)
    diff = ImageChops.difference(image, bg)
    bbox = diff.getbbox()
    
    if bbox:
        pad = 10
        image = image.crop((
            max(0, bbox[0] - pad), 
            max(0, bbox[1] - pad), 
            min(image.width, bbox[2] + pad), 
            min(image.height, bbox[3] + pad)
        ))
    
    # Invert: white strokes on black background (matches training data)
    import PIL.ImageOps
    image = PIL.ImageOps.invert(image)
    
    # Resize to model's expected input size
    transform = transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
    ])
    
    tensor = transform(image).unsqueeze(0)  # [1, 1, 64, 64]
    return tensor


# ──────────────────────────────────────────────
#  Main
# ──────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing arguments. Usage: python judge.py <target_word_1> <target_word_2> ... (image base64 via stdin)"}))
        sys.exit(1)

    base64_img = sys.stdin.read()
    target_words = sys.argv[1:]

    # Path to model files
    model_dir = Path(__file__).parent.parent
    labels_file = model_dir / 'class_names.txt'
    weights_file = model_dir / 'doodle_cnn_improved.pth'

    if not labels_file.exists() or not weights_file.exists():
        print(json.dumps({"error": f"Model files not found. Expected: {weights_file} and {labels_file}"}))
        sys.exit(1)

    # Load labels
    labels = [l.strip() for l in labels_file.read_text().splitlines() if l.strip()]
    num_classes = len(labels)

    # Load model
    model = ImprovedDoodleCNN(num_classes)
    
    try:
        state_dict = torch.load(weights_file, map_location='cpu', weights_only=True)
        model.load_state_dict(state_dict)
        model.eval()
    except Exception as e:
        print(json.dumps({"error": f"Failed to load model weights: {str(e)}"}))
        sys.exit(1)

    # Process image
    try:
        img_tensor = process_image(base64_img)
    except Exception as e:
        print(json.dumps({"error": f"Failed to process image: {str(e)}"}))
        sys.exit(1)

    # Run inference
    with torch.no_grad():
        outputs = model(img_tensor)
        probabilities = torch.nn.functional.softmax(outputs[0], dim=0)

    # Match target words to labels
    # Labels in class_names.txt may use spaces; game labels may use underscores
    # Build lookup that handles both formats
    label_lookup = {}
    for idx, label in enumerate(labels):
        label_lookup[label] = idx
        label_lookup[label.replace(' ', '_')] = idx
        label_lookup[label.replace('_', ' ')] = idx

    results = {}
    winner = None
    max_prob = -1.0
    
    for word in target_words:
        word = word.strip()
        lookup_key = word
        
        if lookup_key in label_lookup:
            idx = label_lookup[lookup_key]
            prob = probabilities[idx].item()
        else:
            prob = 0.0  # Unknown word
            
        results[word] = prob
        
        if prob > max_prob:
            max_prob = prob
            winner = word

    output_data = {
        "success": True,
        "winner": winner,
        "max_prob": max_prob,
        "results": results
    }
    
    print(json.dumps(output_data))

if __name__ == "__main__":
    main()
