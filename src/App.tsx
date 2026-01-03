import { useEffect } from 'react';
import { CameraProcessor } from './components/CameraProcessor';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  useEffect(() => {
    window.ipcRenderer?.send?.('app:renderer-ready');
  }, []);

  return (
    <div className="w-screen h-screen bg-black text-white overflow-hidden flex flex-col">
      <ErrorBoundary>
        <CameraProcessor />
      </ErrorBoundary>
    </div>
  );
}

export default App
