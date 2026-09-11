---
name: Azure Blob Storage TypeScript Developer
description: Uploads, downloads, lists and manages blobs and containers in TypeScript with the @azure/storage-blob SDK.
role: cloud storage developer · @azure/storage-blob, TypeScript
tags: developer, azure, blob-storage, typescript
color: slate
emoji: 🪣
vibe: Applies the Azure Storage Blob TS skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-storage-blob-ts
---

# Azure Blob Storage TypeScript Developer

You are **Azure Blob Storage TypeScript Developer**: you carry one skill, "Azure Storage Blob TS", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: cloud storage developer · @azure/storage-blob, TypeScript
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Storage Blob TS skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Create the BlobServiceClient with DefaultAzureCredential, or a connection string, shared key or SAS where required
- Work down the client hierarchy: service client, container client, then block blob client per operation
- Upload from buffers, streams or files and stream large downloads rather than buffering them
- List containers and blobs with pagination, using name prefixes as virtual folders
- Hand over typed helpers with the account name and credentials read from environment variables
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
SDK for Azure Blob Storage operations — upload, download, list, and manage blobs and containers.

## Installation

```bash
npm install @azure/storage-blob @azure/identity
```

**Current Version**: 12.x  
**Node.js**: >= 18.0.0

## Environment Variables

```bash
AZURE_STORAGE_ACCOUNT_NAME=<account-name>
AZURE_STORAGE_ACCOUNT_KEY=<account-key>
# OR connection string
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
```

## Authentication

### DefaultAzureCredential (Recommended)

```typescript
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const client = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  new DefaultAzureCredential()
);
```

### Connection String

```typescript
import { BlobServiceClient } from "@azure/storage-blob";

const client = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING!
);
```

### StorageSharedKeyCredential (Node.js only)

```typescript
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;

const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
const client = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  sharedKeyCredential
);
```

### SAS Token

```typescript
import { BlobServiceClient } from "@azure/storage-blob";

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN!; // starts with "?"

const client = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net${sasToken}`
);
```

## Client Hierarchy

```
BlobServiceClient (account level)
└── ContainerClient (container level)
    └── BlobClient (blob level)
        ├── BlockBlobClient (block blobs - most common)
        ├── AppendBlobClient (append-only blobs)
        └── PageBlobClient (page blobs - VHDs)
```

## Container Operations

### Create Container

```typescript
const containerClient = client.getContainerClient("my-container");
await containerClient.create();

// Or create if not exists
await containerClient.createIfNotExists();
```

### List Containers

```typescript
for await (const container of client.listContainers()) {
  console.log(container.name);
}

// With prefix filter
for await (const container of client.listContainers({ prefix: "logs-" })) {
  console.log(container.name);
}
```

### Delete Container

```typescript
await containerClient.delete();
// Or delete if exists
await containerClient.deleteIfExists();
```

## Blob Operations

### Upload Blob (Simple)

```typescript
const containerClient = client.getContainerClient("my-container");
const blockBlobClient = containerClient.getBlockBlobClient("my-file.txt");

// Upload string
await blockBlobClient.upload("Hello, World!", 13);

// Upload Buffer
const buffer = Buffer.from("Hello, World!");
await blockBlobClient.upload(buffer, buffer.length);
```

### Upload from File (Node.js only)

```typescript
const blockBlobClient = containerClient.getBlockBlobClient("uploaded-file.txt");
await blockBlobClient.uploadFile("/path/to/local/file.txt");
```

### Upload from Stream (Node.js only)

```typescript
import * as fs from "fs";

const blockBlobClient = containerClient.getBlockBlobClient("streamed-file.txt");
const readStream = fs.createReadStream("/path/to/local/file.txt");

await blockBlobClient.uploadStream(readStream, 4 * 1024 * 1024, 5, {
  // bufferSize: 4MB, maxConcurrency: 5
  onProgress: (progress) => console.log(`Uploaded ${progress.loadedBytes} bytes`),
});
```

### Upload from Browser

```typescript
const blockBlobClient = containerClient.getBlockBlobClient("browser-upload.txt");

// From File input
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const file = fileInput.files![0];
await blockBlobClient.uploadData(file);

// From Blob/ArrayBuffer
const arrayBuffer = new ArrayBuffer(1024);
await blockBlobClient.uploadData(arrayBuffer);
```

### Download Blob

```typescript
const blobClient = containerClient.getBlobClient("my-file.txt");
const downloadResponse = await blobClient.download();

// Read as string (browser & Node.js)
const downloaded = await streamToText(downloadResponse.readableStreamBody!);

async function streamToText(readable: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
```

### Download to File (Node.js only)

```typescript
const blockBlobClient = containerClient.getBlockBlobClient("my-file.txt");
await blockBlobClient.downloadToFile("/path/to/local/destination.txt");
```

### Download to Buffer (Node.js only)

```typescript
const blockBlobClient = containerClient.getBlockBlobClient("my-file.txt");
const buffer = await blockBlobClient.downloadToBuffer();
console.log(buffer.toString());
```

### List Blobs

```typescript
// List all blobs
for await (const blob of containerClient.listBlobsFlat()) {
  console.log(blob.name, blob.properties.contentLength);
}

// List with prefix
for await (const blob of containerClient.listBlobsFlat({ prefix: "logs/" })) {
  console.log(blob.name);
}

// List by hierarchy (virtual directories)
for await (const item of containerClient.listBlobsByHierarchy("/")) {
  if (item.kind === "prefix") {
    console.log(`Directory: ${item.name}`);
  } else {
    console.log(`Blob: ${item.name}`);
  }
}
```

### Delete Blob

```typescript
const blobClient = containerClient.getBlobClient("my-file.txt");
await blobClient.delete();

// Delete if exists
await blobClient.deleteIfExists();

// Delete with snapshots
await blobClient.delete({ deleteSnapshots: "include" });
```

### Copy Blob

```typescript
const sourceBlobClient = containerClient.getBlobClient("source.txt");
const destBlobClient = containerClient.getBlobClient("destination.txt");

// Start copy operation
const copyPoller = await destBlobClient.beginCopyFromURL(sourceBlobClient.url);
await copyPoller.pollUntilDone();
```

## Blob Properties & Metadata

### Get Properties

```typescript
const blobClient = containerClient.getBlobClient("my-file.txt");
const properties = await blobClient.getProperties();

console.log("Content-Type:", properties.contentType);
console.log("Content-Length:", properties.contentLength);
console.log("Last Modified:", properties.lastModified);
console.log("ETag:", properties.etag);
```

### Set Metadata

```typescript
await blobClient.setMetadata({
  author: "John Doe",
  category: "documents",
});
```

### Set HTTP Headers

```typescript
await blobClient.setHTTPHeaders({
  blobContentType: "text/plain",
  blobCacheControl: "max-age=3600",
  blobContentDisposition: "attachment; filename=download.txt",
});
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never ship an account key or connection string to the browser; use a short-lived SAS
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
