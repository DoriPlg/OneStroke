import torch
import torch.nn as nn
import torchvision.models as models

class DoodleResNet(nn.Module):
    """
    ResNet18 adapted for 64x64 grayscale doodle classification.
    """
    def __init__(self, num_classes):
        super().__init__()
        
        # Load a standard ResNet18
        self.resnet = models.resnet18(weights=None)
        
        # Modify the first convolutional layer to accept 1 channel (grayscale) instead of 3
        # The original conv1 is: Conv2d(3, 64, kernel_size=(7, 7), stride=(2, 2), padding=(3, 3), bias=False)
        self.resnet.conv1 = nn.Conv2d(1, 64, kernel_size=7, stride=2, padding=3, bias=False)
        
        # Modify the final fully connected layer to output num_classes
        num_ftrs = self.resnet.fc.in_features
        self.resnet.fc = nn.Linear(num_ftrs, num_classes)
        
    def forward(self, x):
        return self.resnet(x)
