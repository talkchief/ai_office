---
name: IT Professional Azure Storage Blob Java
description: Build blob storage applications using the Azure Storage Blob SDK for Java.
color: slate
emoji: 🛠️
vibe: Applies the Azure Storage Blob Java skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-storage-blob-java
---

# IT Professional Azure Storage Blob Java Agent

You are **IT Professional Azure Storage Blob Java**: you carry one skill, "Azure Storage Blob Java", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Azure Storage Blob Java specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Storage Blob Java skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Azure Storage Blob Java skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# Azure Storage Blob SDK for Java

Build blob storage applications using the Azure Storage Blob SDK for Java.

## Installation

```xml
<dependency>
    <groupId>com.azure</groupId>
    <artifactId>azure-storage-blob</artifactId>
    <version>12.33.0</version>
</dependency>
```

## Client Creation

### BlobServiceClient

```java
import com.azure.storage.blob.BlobServiceClient;
import com.azure.storage.blob.BlobServiceClientBuilder;

// With SAS token
BlobServiceClient serviceClient = new BlobServiceClientBuilder()
    .endpoint("<storage-account-url>")
    .sasToken("<sas-token>")
    .buildClient();

// With connection string
BlobServiceClient serviceClient = new BlobServiceClientBuilder()
    .connectionString("<connection-string>")
    .buildClient();
```

### With DefaultAzureCredential

```java
import com.azure.identity.DefaultAzureCredentialBuilder;

BlobServiceClient serviceClient = new BlobServiceClientBuilder()
    .endpoint("<storage-account-url>")
    .credential(new DefaultAzureCredentialBuilder().build())
    .buildClient();
```

### BlobContainerClient

```java
import com.azure.storage.blob.BlobContainerClient;

// From service client
BlobContainerClient containerClient = serviceClient.getBlobContainerClient("mycontainer");

// Direct construction
BlobContainerClient containerClient = new BlobContainerClientBuilder()
    .connectionString("<connection-string>")
    .containerName("mycontainer")
    .buildClient();
```

### BlobClient

```java
import com.azure.storage.blob.BlobClient;

// From container client
BlobClient blobClient = containerClient.getBlobClient("myblob.txt");

// With directory structure
BlobClient blobClient = containerClient.getBlobClient("folder/subfolder/myblob.txt");

// Direct construction
BlobClient blobClient = new BlobClientBuilder()
    .connectionString("<connection-string>")
    .containerName("mycontainer")
    .blobName("myblob.txt")
    .buildClient();
```

## Core Patterns

### Create Container

```java
// Create container
serviceClient.createBlobContainer("mycontainer");

// Create if not exists
BlobContainerClient container = serviceClient.createBlobContainerIfNotExists("mycontainer");

// From container client
containerClient.create();
containerClient.createIfNotExists();
```

### Upload Data

```java
import com.azure.core.util.BinaryData;

// Upload string
String data = "Hello, Azure Blob Storage!";
blobClient.upload(BinaryData.fromString(data));

// Upload with overwrite
blobClient.upload(BinaryData.fromString(data), true);
```

### Upload from File

```java
blobClient.uploadFromFile("local-file.txt");

// With overwrite
blobClient.uploadFromFile("local-file.txt", true);
```

### Upload from Stream

```java
import com.azure.storage.blob.specialized.BlockBlobClient;

BlockBlobClient blockBlobClient = blobClient.getBlockBlobClient();

try (ByteArrayInputStream dataStream = new ByteArrayInputStream(data.getBytes())) {
    blockBlobClient.upload(dataStream, data.length());
}
```

### Upload with Options

```java
import com.azure.storage.blob.models.BlobHttpHeaders;
import com.azure.storage.blob.options.BlobParallelUploadOptions;

BlobHttpHeaders headers = new BlobHttpHeaders()
    .setContentType("text/plain")
    .setCacheControl("max-age=3600");

Map<String, String> metadata = Map.of("author", "john", "version", "1.0");

try (InputStream stream = new FileInputStream("large-file.bin")) {
    BlobParallelUploadOptions options = new BlobParallelUploadOptions(stream)
        .setHeaders(headers)
        .setMetadata(metadata);
    
    blobClient.uploadWithResponse(options, null, Context.NONE);
}
```

### Upload if Not Exists

```java
import com.azure.storage.blob.models.BlobRequestConditions;

BlobParallelUploadOptions options = new BlobParallelUploadOptions(inputStream, length)
    .setRequestConditions(new BlobRequestConditions().setIfNoneMatch("*"));

blobClient.uploadWithResponse(options, null, Context.NONE);
```

### Download Data

```java
// Download to BinaryData
BinaryData content = blobClient.downloadContent();
String text = content.toString();

// Download to file
blobClient.downloadToFile("downloaded-file.txt");
```

### Download to Stream

```java
try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
    blobClient.downloadStream(outputStream);
    byte[] data = outputStream.toByteArray();
}
```

### Download with InputStream

```java
import com.azure.storage.blob.specialized.BlobInputStream;

try (BlobInputStream blobIS = blobClient.openInputStream()) {
    byte[] buffer = new byte[1024];
    int bytesRead;
    while ((bytesRead = blobIS.read(buffer)) != -1) {
        // Process buffer
    }
}
```

### Upload via OutputStream

```java
import com.azure.storage.blob.specialized.BlobOutputStream;

try (BlobOutputStream blobOS = blobClient.getBlockBlobClient().getBlobOutputStream()) {
    blobOS.write("Data to upload".getBytes());
}
```

### List Blobs

```java
import com.azure.storage.blob.models.BlobItem;

// List all blobs
for (BlobItem blobItem : containerClient.listBlobs()) {
    System.out.println("Blob: " + blobItem.getName());
}

// List with prefix (virtual directory)
import com.azure.storage.blob.models.ListBlobsOptions;

ListBlobsOptions options = new ListBlobsOptions().setPrefix("folder/");
for (BlobItem blobItem : containerClient.listBlobs(options, null)) {
    System.out.println("Blob: " + blobItem.getName());
}
```

### List Blobs by Hierarchy

```java
import com.azure.storage.blob.models.BlobListDetails;

String delimiter = "/";
ListBlobsOptions options = new ListBlobsOptions()
    .setPrefix("data/")
    .setDetails(new BlobListDetails().setRetrieveMetadata(true));

for (BlobItem item : containerClient.listBlobsByHierarchy(delimiter, options, null)) {
    if (item.isPrefix()) {
        System.out.println("Directory: " + item.getName());
    } else {
        System.out.println("Blob: " + item.getName());
    }
}
```

### Delete Blob

```java
blobClient.delete();

// Delete if exists
blobClient.deleteIfExists();

// Delete with snapshots
import com.azure.storage.blob.models.DeleteSnapshotsOptionType;
blobClient.deleteWithResponse(DeleteSnapshotsOptionType.INCLUDE, null, null, Context.NONE);
```

### Copy Blob

```java
import com.azure.storage.blob.models.BlobCopyInfo;
import com.azure.core.util.polling.SyncPoller;

// Async copy (for large blobs or cross-account)
SyncPoller<BlobCopyInfo, Void> poller = blobClient.beginCopy("<source-blob-url>", Duration.ofSeconds(1));
poller.waitForCompletion();

// Sync copy from URL (for same account)
blobClient.copyFromUrl("<source-blob-url>");
```

### Generate SAS Token

```java
import com.azure.storage.blob.sas.*;
import java.time.OffsetDateTime;

// Blob-level SAS
Blob

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
