# Huanlian (Face Swap App)

A desktop application built with Electron, React, and MediaPipe that enables real-time face swapping, avatar overlay, and background replacement.

## 🚀 Features

- **Real-time Face Swapping**: Detects faces in the webcam feed and swaps them with a user-uploaded target face.
- **Avatar Overlay**: Supports 3D avatar overlay on the user's face.
- **Background Replacement**: Remove or replace the video background with a custom image.
- **Multi-Backend Support**: Toggle between different rendering backends (D3D11, D3D9, OpenGL, Vulkan) for optimal performance.
- **Privacy Focused**: All processing happens locally on your device.

## 🛠️ Tech Stack

- **Frontend**: React, TailwindCSS
- **Desktop Framework**: Electron, Vite
- **Computer Vision**: Google MediaPipe (Face Landmarker, Selfie Segmentation)
- **3D Graphics**: Three.js, React Three Fiber

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/BaimingX/huanlian.git
   cd huanlian
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```

4. **Build for Production**
   ```bash
   npm run build
   ```

## 🎮 Usage

1. Launch the application.
2. Grant camera permissions.
3. Use the sidebar controls to:
    - Upload a target face for face swapping.
    - Upload a background image.
    - Toggle between Avatar and Face Swap modes.
    - Adjust performance settings.

## 📄 License

[MIT](LICENSE)
