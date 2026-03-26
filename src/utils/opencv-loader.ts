/* eslint-disable @typescript-eslint/no-explicit-any */

declare const cv: any;

let ready = false;
let readyPromise: Promise<void> | null = null;

export function waitForOpenCV(): Promise<void> {
  if (ready && typeof cv !== 'undefined' && cv.Mat) return Promise.resolve();

  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve) => {
    if (typeof cv !== 'undefined' && cv.Mat) {
      ready = true;
      resolve();
      return;
    }
    document.addEventListener('opencv-ready', () => {
      ready = true;
      resolve();
    }, { once: true });
  });

  return readyPromise;
}

export function isOpenCVReady(): boolean {
  return ready && typeof cv !== 'undefined' && cv.Mat;
}
