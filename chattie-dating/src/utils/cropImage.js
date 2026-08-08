/**
 * ============================================================================
 * CHATTIE IMAGE PROCESSING ENGINE
 * Utility suite for cropping, rotating, flipping, and compressing user images.
 * ============================================================================
 */

export const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => {
      console.error('Error loading image source:', error);
      reject(error);
    });
    // Prevent cross-origin canvas tainting issues
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

export function getRadianAngle(degreeValue) {
  return (degreeValue * Math.PI) / 180;
}

/**
 * Returns the new bounding area of a rotated rectangle.
 */
export function rotateSize(width, height, rotation) {
  const rotRad = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

/**
 * Generates a cropped (and optionally rotated/flipped) version of an image.
 * Returns a Blob, Object URL, and File payload ready for Spring Boot.
 * 
 * @param {string} imageSrc - The source URL or Base64 of the image
 * @param {Object} pixelCrop - { x, y, width, height }
 * @param {number} rotation - Rotation in degrees (default: 0)
 * @param {Object} flip - { horizontal: boolean, vertical: boolean }
 * @param {Object} config - { format: 'image/jpeg' | 'image/webp' | 'image/png', quality: number }
 */
export async function getCroppedImg(
  imageSrc,
  pixelCrop,
  rotation = 0,
  flip = { horizontal: false, vertical: false },
  config = { format: 'image/jpeg', quality: 0.9 }
) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('No 2d context available. Browser may not support Canvas.');
  }

  const rotRad = getRadianAngle(rotation);

  // 1. Calculate bounding box of the rotated image
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(image.width, image.height, rotation);

  // 2. Set canvas size to match the bounding box
  canvas.width = bBoxWidth;
  canvas.height = bBoxHeight;

  // 3. Translate canvas context to a central location to allow rotating and flipping around the center
  ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
  ctx.rotate(rotRad);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
  ctx.translate(-image.width / 2, -image.height / 2);

  // 4. Draw rotated/flipped image
  ctx.drawImage(image, 0, 0);

  // 5. Extract the cropped image data from the canvas
  const croppedCanvas = document.createElement('canvas');
  const croppedCtx = croppedCanvas.getContext('2d');

  if (!croppedCtx) {
    throw new Error('No 2d context available for cropped canvas.');
  }

  // Set the size of the cropped canvas
  croppedCanvas.width = pixelCrop.width;
  croppedCanvas.height = pixelCrop.height;

  // Draw the extracted data onto the cropped canvas
  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  // 6. Output the final processed image
  return new Promise((resolve, reject) => {
    croppedCanvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas is empty'));
          return;
        }
        
        // Append a timestamp to prevent browser caching issues when uploading
        const fileName = `chattie_avatar_${Date.now()}.${config.format.split('/')[1]}`;
        blob.name = fileName;
        
        // Generate a URL for immediate UI preview (Remember to URL.revokeObjectURL(url) later to avoid memory leaks)
        const previewUrl = URL.createObjectURL(blob);
        
        // Create an actual File object, which Spring Boot MultiPartFile expects
        const file = new File([blob], fileName, { type: config.format });

        resolve({ 
          blob, 
          file,
          url: previewUrl 
        });
      },
      config.format,
      config.quality
    );
  });
}

/**
 * Utility: Converts a File or Blob directly to a Base64 string.
 * Extremely useful for sending small attachments over the WebSocket in the LiveRoom.
 */
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Utility: Quick compressor for massive camera uploads before sending to crop.
 * Prevents mobile browsers from crashing when loading 12MB photos into memory.
 */
export const compressImageFile = async (file, maxWidth = 1200, quality = 0.8) => {
  const base64 = await fileToBase64(file);
  const image = await createImage(base64);
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  let { width, height } = image;
  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Compression failed'));
        const compressedFile = new File([blob], file.name, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        resolve(compressedFile);
      },
      'image/jpeg',
      quality
    );
  });
};