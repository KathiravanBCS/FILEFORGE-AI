interface FileAvailability {
  label: string;
  color: 'teal' | 'orange' | 'blue' | 'red' | 'gray';
  canDownload: boolean;
  description?: string;
}
/** A reserved file is not downloadable until the API has verified its stored image. */
export function fileAvailability(status: string | undefined): FileAvailability {
  switch (status) {
    case 'uploaded':
      return { label: 'Uploaded', color: 'teal', canDownload: true };
    case 'pending':
      return {
        label: 'Upload incomplete',
        color: 'orange',
        canDownload: false,
        description:
          'The upload has not finished. Refresh after uploading, or try the image again in Scanner.',
      };
    case 'validating':
      return {
        label: 'Checking upload',
        color: 'blue',
        canDownload: false,
        description: 'The image is being checked. Refresh shortly.',
      };
    case 'rejected':
      return {
        label: 'Upload rejected',
        color: 'red',
        canDownload: false,
        description: 'This image was not accepted. Try another JPG, PNG, or WebP image.',
      };
    case 'failed':
      return {
        label: 'Upload failed',
        color: 'red',
        canDownload: false,
        description: 'This upload failed. Try the image again in Scanner.',
      };
    case 'expired':
      return {
        label: 'Upload expired',
        color: 'gray',
        canDownload: false,
        description: 'This upload expired. Try the image again in Scanner.',
      };
    default:
      return {
        label: 'Unavailable',
        color: 'gray',
        canDownload: false,
        description: 'This file is not available for download.',
      };
  }
}
