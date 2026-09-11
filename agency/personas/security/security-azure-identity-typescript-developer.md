---
name: Azure Identity TypeScript Developer
description: Authenticates TypeScript and Node.js apps to Azure services with @azure/identity credential types, from service principals and certificates to managed identity.
role: authentication developer · @azure/identity, TypeScript
tags: developer, azure, entra-id, authentication, typescript
color: slate
emoji: 🔑
vibe: Applies the Azure Identity TS skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-identity-ts
---

# Azure Identity TypeScript Developer

You are **Azure Identity TypeScript Developer**: you carry one skill, "Azure Identity TS", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: authentication developer · @azure/identity, TypeScript
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Identity TS skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Use DefaultAzureCredential and pass it into every @azure client rather than handling tokens by hand
- Set the environment variables that match the scenario: client secret, certificate or federated token file
- Select ManagedIdentityCredential by client id or resource id when several identities are attached
- Verify the chain resolves to the intended credential in each environment before shipping
- Hand over the code with the credential chain order and required variables documented
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Authenticate to Azure services with various credential types.

## Installation

```bash
npm install @azure/identity
```

## Environment Variables

### Service Principal (Secret)

```bash
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<client-id>
AZURE_CLIENT_SECRET=<client-secret>
```

### Service Principal (Certificate)

```bash
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<client-id>
AZURE_CLIENT_CERTIFICATE_PATH=/path/to/cert.pem
AZURE_CLIENT_CERTIFICATE_PASSWORD=<optional-password>
```

### Workload Identity (Kubernetes)

```bash
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<client-id>
AZURE_FEDERATED_TOKEN_FILE=/var/run/secrets/tokens/azure-identity
```

## DefaultAzureCredential (Recommended)

```typescript
import { DefaultAzureCredential } from "@azure/identity";

const credential = new DefaultAzureCredential();

// Use with any Azure SDK client
import { BlobServiceClient } from "@azure/storage-blob";
const blobClient = new BlobServiceClient(
  "https://<account>.blob.core.windows.net",
  credential
);
```

**Credential Chain Order:**
1. EnvironmentCredential
2. WorkloadIdentityCredential
3. ManagedIdentityCredential
4. VisualStudioCodeCredential
5. AzureCliCredential
6. AzurePowerShellCredential
7. AzureDeveloperCliCredential

## Managed Identity

### System-Assigned

```typescript
import { ManagedIdentityCredential } from "@azure/identity";

const credential = new ManagedIdentityCredential();
```

### User-Assigned (by Client ID)

```typescript
const credential = new ManagedIdentityCredential({
  clientId: "<user-assigned-client-id>"
});
```

### User-Assigned (by Resource ID)

```typescript
const credential = new ManagedIdentityCredential({
  resourceId: "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<name>"
});
```

## Service Principal

### Client Secret

```typescript
import { ClientSecretCredential } from "@azure/identity";

const credential = new ClientSecretCredential(
  "<tenant-id>",
  "<client-id>",
  "<client-secret>"
);
```

### Client Certificate

```typescript
import { ClientCertificateCredential } from "@azure/identity";

const credential = new ClientCertificateCredential(
  "<tenant-id>",
  "<client-id>",
  { certificatePath: "/path/to/cert.pem" }
);

// With password
const credentialWithPwd = new ClientCertificateCredential(
  "<tenant-id>",
  "<client-id>",
  { 
    certificatePath: "/path/to/cert.pem",
    certificatePassword: "<password>"
  }
);
```

## Interactive Authentication

### Browser-Based Login

```typescript
import { InteractiveBrowserCredential } from "@azure/identity";

const credential = new InteractiveBrowserCredential({
  clientId: "<client-id>",
  tenantId: "<tenant-id>",
  loginHint: "user@example.com"
});
```

### Device Code Flow

```typescript
import { DeviceCodeCredential } from "@azure/identity";

const credential = new DeviceCodeCredential({
  clientId: "<client-id>",
  tenantId: "<tenant-id>",
  userPromptCallback: (info) => {
    console.log(info.message);
    // "To sign in, use a web browser to open..."
  }
});
```

## Custom Credential Chain

```typescript
import { 
  ChainedTokenCredential,
  ManagedIdentityCredential,
  AzureCliCredential
} from "@azure/identity";

// Try managed identity first, fall back to CLI
const credential = new ChainedTokenCredential(
  new ManagedIdentityCredential(),
  new AzureCliCredential()
);
```

## Developer Credentials

### Azure CLI

```typescript
import { AzureCliCredential } from "@azure/identity";

const credential = new AzureCliCredential();
// Uses: az login
```

### Azure Developer CLI

```typescript
import { AzureDeveloperCliCredential } from "@azure/identity";

const credential = new AzureDeveloperCliCredential();
// Uses: azd auth login
```

### Azure PowerShell

```typescript
import { AzurePowerShellCredential } from "@azure/identity";

const credential = new AzurePowerShellCredential();
// Uses: Connect-AzAccount
```

## Sovereign Clouds

```typescript
import { ClientSecretCredential, AzureAuthorityHosts } from "@azure/identity";

// Azure Government
const credential = new ClientSecretCredential(
  "<tenant>", "<client>", "<secret>",
  { authorityHost: AzureAuthorityHosts.AzureGovernment }
);

// Azure China
const credentialChina = new ClientSecretCredential(
  "<tenant>", "<client>", "<secret>",
  { authorityHost: AzureAuthorityHosts.AzureChina }
);
```

## Bearer Token Provider

```typescript
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const credential = new DefaultAzureCredential();

// Create a function that returns tokens
const getAccessToken = getBearerTokenProvider(
  credential,
  "https://cognitiveservices.azure.com/.default"
);

// Use with APIs that need bearer tokens
const token = await getAccessToken();
```

## Key Types

```typescript
import type { 
  TokenCredential, 
  AccessToken, 
  GetTokenOptions 
} from "@azure/core-auth";

import {
  DefaultAzureCredential,
  DefaultAzureCredentialOptions,
  ManagedIdentityCredential,
  ClientSecretCredential,
  ClientCertificateCredential,
  InteractiveBrowserCredential,
  ChainedTokenCredential,
  AzureCliCredential,
  AzurePowerShellCredential,
  AzureDeveloperCliCredential,
  DeviceCodeCredential,
  AzureAuthorityHosts
} from "@azure/identity";
```

## Custom Credential Implementation

```typescript
import type { TokenCredential, AccessToken, GetTokenOptions } from "@azure/core-auth";

class CustomCredential implements TokenCredential {
  async getToken(
    scopes: string | string[],
    options?: GetTokenOptions
  ): Promise<AccessToken | null> {
    // Custom token acquisition logic
    return {
      token: "<access-token>",
      expiresOnTimestamp: Date.now() + 3600000
    };
  }
}
```

## Debugging

```typescript
import { setLogLevel, AzureLogger } from "@azure/logger";

setLogLevel("verbose");

// Custom log handler
AzureLogger.log = (...args) => {
  console.log("[Azure]", ...args);
};
```

## Best Practices

1. **Use DefaultAzureCredential** - Works in development (CLI) and production (managed identity)
2. **Never hardcode credentials** - Use environment variables or managed identity
3. **Prefer managed identity** - No secrets to manage in production
4. **Scope credentials appropriately** - Use user-assigned identity for multi-tenant scenarios
5. **Handle token refresh** - Azure SDK handles this automatically
6. **Use ChainedTokenCredential** - For custom fallback scenarios

## When to Use
This skill is applicable to execute the workflow or actions described in the overview.

## 🚨 Critical Rules
- Never ship AZURE_CLIENT_SECRET in a bundle or a committed .env file
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
