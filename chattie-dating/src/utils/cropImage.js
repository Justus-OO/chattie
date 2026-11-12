/**
 * ============================================================================
 * CHATTIE IMAGE PROCESSING ENGINE
 * Utility suite for cropping, rotating, flipping, compressing, and AI Face Detection.
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

  croppedCanvas.width = pixelCrop.width;
  croppedCanvas.height = pixelCrop.height;

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
        
        const fileName = `chattie_avatar_${Date.now()}.${config.format.split('/')[1]}`;
        blob.name = fileName;
        
        const previewUrl = URL.createObjectURL(blob);
        const file = new File([blob], fileName, { type: config.format });

        resolve({ blob, file, url: previewUrl });
      },
      config.format,
      config.quality
    );
  });
}

/**
 * Utility: Converts a File or Blob directly to a Base64 string.
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
 * Utility: Quick compressor for massive camera uploads.
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

/**
 * ============================================================================
 * AI SMART CROP (MAGIC SELFIE DETECTION)
 * Uses native browser ML to detect a face, validate it's a solo selfie,
 * and calculate the perfect padded bounding box for an avatar.
 * ============================================================================
 */
export const smartFaceCrop = async (file, config = { format: 'image/jpeg', quality: 0.9 }) => {
  const base64 = await fileToBase64(file);
  const image = await createImage(base64);

  if (!('FaceDetector' in window)) {
    throw new Error('UNSUPPORTED_BROWSER');
  }

  const detector = new window.FaceDetector({ fastMode: false, maxDetectedFaces: 3 });
  const faces = await detector.detect(image);

  if (faces.length === 0) throw new Error('NO_FACE_DETECTED');
  if (faces.length > 1) throw new Error('MULTIPLE_FACES_DETECTED');

  const face = faces[0].boundingBox;

  const paddingMultiplier = 0.8;
  let cropSize = Math.max(face.width, face.height) * (1 + paddingMultiplier);
  
  cropSize = Math.min(cropSize, image.width, image.height);

  const faceCenterX = face.x + (face.width / 2);
  const faceCenterY = face.y + (face.height / 2);

  let cropX = faceCenterX - (cropSize / 2);
  let cropY = faceCenterY - (cropSize / 2);

  if (cropX < 0) cropX = 0;
  if (cropY < 0) cropY = 0;
  if (cropX + cropSize > image.width) cropX = image.width - cropSize;
  if (cropY + cropSize > image.height) cropY = image.height - cropSize;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = cropSize;
  canvas.height = cropSize;

  ctx.drawImage(
    image,
    cropX, cropY, cropSize, cropSize,
    0, 0, cropSize, cropSize
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Canvas empty'));
        
        const fileName = `chattie_magic_avatar_${Date.now()}.${config.format.split('/')[1]}`;
        blob.name = fileName;
        
        const previewUrl = URL.createObjectURL(blob);
        const croppedFile = new File([blob], fileName, { type: config.format });

        resolve({ blob, file: croppedFile, url: previewUrl });
      },
      config.format,
      config.quality
    );
  });
};