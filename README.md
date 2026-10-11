# Stark

> Built at Knight Hacks IX (9–11 October 2026).

## What Stark is

<!-- TODO (Ray): summary from master plan section 1, plus a screenshot or GIF. -->

## How it works

<!-- TODO (Ray): pipeline → precomputed assets → 3D renderer → Socket.io controllers. -->

## Features

<!-- TODO (Ray): the tree, Grad-CAM per answer, the trunk interior, prediction stability (TTA), adversarial example (FGSM), medical card, multi-device control. -->

## Running it locally

<!-- TODO (Ray): local run steps and the live Render link. -->

## AI usage

**AI usage.** This project was built during Knight Hacks with the help of generative AI coding tools, as permitted by MLH rules. Claude Code (Anthropic) was used for the Python precompute pipeline, the Node/Socket.io server, and the Three.js renderer. Codex (OpenAI) was used for the controller pages and HUD. I designed the architecture and the data contract between components, made the technical and design decisions, split the work between agents, and reviewed and integrated all generated code. Planning before the event was done with Claude (conversation only; no code was written before the event).

**Models used:** ResNet50 with ImageNet weights (Keras Applications); DenseNet121 chest X-ray model from torchxrayvision. Stark is not a wrapper around an LLM or API: it visualizes the internal behavior of image models.

**Prior work:** the phone/tablet controller design was inspired by an earlier personal project of mine; all code here was written during the event.

## Credits

<!-- TODO (Ray): images, datasets, libraries (ResNet50 / Keras Applications, torchxrayvision, Three.js, Socket.io, NLTK WordNet). Image sources and licenses are listed in credits.txt. -->
