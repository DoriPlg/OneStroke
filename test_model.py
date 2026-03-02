import sys
import json
import torch
from pathlib import Path
from PIL import Image
import torchvision.transforms as transforms
import io
import base64
import os

# Add parent directory to path so we can import model.py
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from model import ImprovedDoodleCNN

IMG_SIZE = 64

def process_image(base64_img):
    """Convert a base64-encoded canvas image to a model-ready tensor."""
    if ',' in base64_img:
        base64_img = base64_img.split(',')[1]
        
    missing_padding = len(base64_img) % 4
    if missing_padding:
        base64_img += '=' * (4 - missing_padding)
        
    image_data = base64.b64decode(base64_img)
    image = Image.open(io.BytesIO(image_data))
    
    if image.mode == 'RGBA':
        background = Image.new('RGB', image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3]) 
        image = background
        
    image = image.convert('L')
    
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
    
    import PIL.ImageOps
    image = PIL.ImageOps.invert(image)
    
    transform = transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
    ])
    
    tensor = transform(image).unsqueeze(0)
    return tensor

def main():
    base64_img = sys.stdin.read()

    model_dir = Path(__file__).parent
    labels_file = model_dir / 'class_names.txt'
    weights_file = model_dir / 'doodle_cnn_improved.pth'

    if not labels_file.exists() or not weights_file.exists():
        print(json.dumps({"error": f"Model files not found. Expected: {weights_file} and {labels_file}"}))
        sys.exit(1)

    labels = [l.strip() for l in labels_file.read_text().splitlines() if l.strip()]
    num_classes = len(labels)

    model = ImprovedDoodleCNN(num_classes)
    
    try:
        state_dict = torch.load(weights_file, map_location='cpu', weights_only=True)
        model.load_state_dict(state_dict)
        model.eval()
    except Exception as e:
        print(json.dumps({"error": f"Failed to load model weights: {str(e)}"}))
        sys.exit(1)

    try:
        img_tensor = process_image(base64_img)
    except Exception as e:
        print(json.dumps({"error": f"Failed to process image: {str(e)}"}))
        sys.exit(1)

    with torch.no_grad():
        outputs = model(img_tensor)
        probabilities = torch.nn.functional.softmax(outputs[0], dim=0)

    # Get top 10 predictions
    top_probs, top_indices = torch.topk(probabilities, 10)
    
    results = []
    for prob, idx in zip(top_probs, top_indices):
        results.append({
            "label": labels[idx.item()],
            "probability": prob.item()
        })

    output_data = {
        "success": True,
        "predictions": results
    }
    
    print(json.dumps(output_data))

if __name__ == "__main__":
    main()
