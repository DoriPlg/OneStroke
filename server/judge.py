import sys
import json
import torch
from torch import nn
from pathlib import Path
from PIL import Image
import torchvision.transforms as transforms
import io
import base64

# Define the CNN architecture as used in model.ipynb
class DoodleCNN(nn.Module):
    def __init__(self, num_classes):
        super(DoodleCNN, self).__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding='same'),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding='same'),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding='same'),
            nn.ReLU(),
            nn.MaxPool2d(2),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(1152, 256),
            nn.ReLU(),
            nn.Linear(256, num_classes)
        )

    def forward(self, x):
        x = self.features(x)
        x = self.classifier(x)
        return x

def process_image(base64_img):
    # Remove data log from base64 if present
    if ',' in base64_img:
        base64_img = base64_img.split(',')[1]
        
    image_data = base64.b64decode(base64_img)
    image = Image.open(io.BytesIO(image_data))
    
    # We want white lines on black background as per the training data
    # The canvas likely has black strokes on white background
    
    # Extract alpha channel if it exists, otherwise convert to grayscale and invert
    if image.mode == 'RGBA':
        # Create a white background image
        background = Image.new('RGB', image.size, (255, 255, 255))
        # Paste the image on the background.
        background.paste(image, mask=image.split()[3]) 
        image = background
        
    image = image.convert('L')
    
    # Find bounding box of drawing (non-white pixels)
    from PIL import ImageChops
    bg = Image.new(image.mode, image.size, 255)
    diff = ImageChops.difference(image, bg)
    bbox = diff.getbbox()
    
    if bbox:
        # Crop to contents with slight padding
        image = image.crop((max(0, bbox[0]-10), 
                            max(0, bbox[1]-10), 
                            min(image.width, bbox[2]+10), 
                            min(image.height, bbox[3]+10)))
    
    # Invert to white lines on black background
    import PIL.ImageOps
    image = PIL.ImageOps.invert(image)
    
    # Convert to 28x28 as the model expects
    transform = transforms.Compose([
        transforms.Resize((28, 28)),
        transforms.ToTensor(),
    ])
    
    tensor = transform(image).unsqueeze(0) # Add batch dimension [1, 1, 28, 28]
    return tensor

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments. Usage: python judge.py <base64_image> <target_word_1> <target_word_2> ..."}))
        sys.exit(1)

    base64_img = sys.argv[1]
    target_words = sys.argv[2:]

    # Path to model files (relative to where Node.js spawns this, which is /server)
    model_dir = Path(__file__).parent.parent / 'hf_model'
    labels_file = model_dir / 'class_names.txt'
    weights_file = model_dir / 'pytorch_model.bin'

    if not labels_file.exists() or not weights_file.exists():
        print(json.dumps({"error": f"Model files not found in {model_dir}"}))
        sys.exit(1)

    # Load labels
    labels = labels_file.read_text().splitlines()
    num_classes = len(labels)

    # Note: Using the exact Sequential layer structure expected by state dict since that's how it was saved
    model = nn.Sequential(
        nn.Conv2d(1, 32, 3, padding='same'),
        nn.ReLU(),
        nn.MaxPool2d(2),
        nn.Conv2d(32, 64, 3, padding='same'),
        nn.ReLU(),
        nn.MaxPool2d(2),
        nn.Conv2d(64, 128, 3, padding='same'),
        nn.ReLU(),
        nn.MaxPool2d(2),
        nn.Flatten(),
        nn.Linear(1152, 256),
        nn.ReLU(),
        nn.Linear(256, num_classes)
    )

    try:
        state_dict = torch.load(weights_file, map_location='cpu', weights_only=True)
        model.load_state_dict(state_dict, strict=False)
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

    # Construct results dictionary
    results = {}
    winner = None
    max_prob = -1.0
    
    for word in target_words:
        if word in labels:
            idx = labels.index(word)
            prob = probabilities[idx].item()
        else:
            prob = 0.0 # Unknown word
            
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
