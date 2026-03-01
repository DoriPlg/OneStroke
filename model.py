import torch
import torch.nn as nn
import torchvision.models as models


class DoodleResNet(nn.Module):
    """
    ResNet18 fine-tuned for 64x64 grayscale doodle classification.

    Strategy: Load ImageNet pretrained weights (all RGB layers). Since our
    images are single-channel grayscale, we replicate the channel to 3 in
    forward() so the pretrained conv1 weights are used without modification.
    Only the final FC layer is randomly initialized for our num_classes.
    """
    def __init__(self, num_classes):
        super().__init__()

        # Load ResNet18 with ImageNet pretrained weights
        self.resnet = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)

        # Freeze ALL backbone layers — only the new head will be trained
        for param in self.resnet.parameters():
            param.requires_grad = False

        # Replace the classification head for our number of classes (trainable)
        num_ftrs = self.resnet.fc.in_features
        self.resnet.fc = nn.Linear(num_ftrs, num_classes)

    def forward(self, x):
        # x: [B, 1, H, W] grayscale — repeat to 3 channels for pretrained backbone
        x = x.repeat(1, 3, 1, 1)
        return self.resnet(x)

