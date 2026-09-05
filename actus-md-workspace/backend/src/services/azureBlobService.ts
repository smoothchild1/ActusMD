import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

/**
 * Azure Blob Storage - Tier 1 raw artifact file storage.
 *
 * Backs the append-only Artifact databank: dictated audio, scanned chart
 * images, and any other raw binary payloads live here, keyed by
 * `<patientId>/<artifactId>/<filename>`. Metadata about each blob (who
 * created it, its extracted text, etc.) lives in Postgres via the
 * `Artifact` model, not here.
 *
 * Local dev points this at the Azurite emulator via
 * AZURE_STORAGE_CONNECTION_STRING; production points it at a real Azure
 * Storage account connection string / managed identity, with no code
 * changes required.
 *
 * There is deliberately no delete/overwrite function: Tier 1 is append-only,
 * so corrections must be uploaded as new blobs tied to a new addendum
 * Artifact row rather than mutating existing ones.
 */

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING ?? '';
const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'clinical-artifacts';

export function isBlobStorageConfigured(): boolean {
  return Boolean(CONNECTION_STRING);
}

let containerClientPromise: Promise<ContainerClient> | null = null;

function getContainerClient(): Promise<ContainerClient> {
  if (!isBlobStorageConfigured()) {
    throw new Error(
      'Azure Blob Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING ' +
        '(and optionally AZURE_STORAGE_CONTAINER_NAME) in .env.',
    );
  }
  if (!containerClientPromise) {
    containerClientPromise = (async () => {
      const serviceClient = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
      const container = serviceClient.getContainerClient(CONTAINER_NAME);
      await container.createIfNotExists();
      return container;
    })();
  }
  return containerClientPromise;
}

export interface UploadArtifactBlobInput {
  patientId: string;
  artifactId: string;
  /** Original filename, used only to preserve the extension. */
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface UploadArtifactBlobResult {
  /** Blob name (path within the container) - store this in Artifact.blobUrl. */
  blobName: string;
  /** Fully-qualified URL to the blob on the configured storage account/emulator. */
  url: string;
  size: number;
  contentType: string;
}

function buildBlobName(patientId: string, artifactId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${patientId}/${artifactId}/${safeName}`;
}

/** Upload a raw artifact file (audio recording, scanned chart image, etc.). */
export async function uploadArtifactBlob(
  input: UploadArtifactBlobInput,
): Promise<UploadArtifactBlobResult> {
  const container = await getContainerClient();
  const blobName = buildBlobName(input.patientId, input.artifactId, input.filename);
  const blockBlobClient = container.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(input.data, {
    blobHTTPHeaders: { blobContentType: input.contentType },
  });

  return {
    blobName,
    url: blockBlobClient.url,
    size: input.data.length,
    contentType: input.contentType,
  };
}

/** Download a previously uploaded artifact file by its blob name. */
export async function downloadArtifactBlob(blobName: string): Promise<Buffer> {
  const container = await getContainerClient();
  const blockBlobClient = container.getBlockBlobClient(blobName);
  return blockBlobClient.downloadToBuffer();
}
