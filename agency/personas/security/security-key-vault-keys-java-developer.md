---
name: Key Vault Keys Java Developer
description: Manages RSA and EC keys in Azure Key Vault and Managed HSM from Java and runs encrypt, decrypt, sign and verify operations.
role: cryptographic key developer · Key Vault, Managed HSM, Java
tags: developer, azure, key-vault, cryptography, java
color: slate
emoji: 🔐
vibe: Applies the Azure Security Keyvault Keys Java skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-security-keyvault-keys-java
---

# Key Vault Keys Java Developer

You are **Key Vault Keys Java Developer**: you carry one skill, "Azure Security Keyvault Keys Java", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: cryptographic key developer · Key Vault, Managed HSM, Java
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Security Keyvault Keys Java skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Add azure-security-keyvault-keys and build KeyClient with DefaultAzureCredentialBuilder against the vault URL
- Pick the key type for the job: RSA, EC, or symmetric OCT keys which exist on Managed HSM only
- Create RSA and EC keys with an explicit size or curve, then manage versions, properties and deletion
- Bind a CryptographyClient to a key identifier for encrypt, decrypt, sign and verify
- Choose the sync or async client deliberately and hand over Java with the dependency coordinates
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Manage cryptographic keys and perform cryptographic operations in Azure Key Vault and Managed HSM.

## Installation

```xml
<dependency>
    <groupId>com.azure</groupId>
    <artifactId>azure-security-keyvault-keys</artifactId>
    <version>4.9.0</version>
</dependency>
```

## Client Creation

```java
import com.azure.security.keyvault.keys.KeyClient;
import com.azure.security.keyvault.keys.KeyClientBuilder;
import com.azure.security.keyvault.keys.cryptography.CryptographyClient;
import com.azure.security.keyvault.keys.cryptography.CryptographyClientBuilder;
import com.azure.identity.DefaultAzureCredentialBuilder;

// Key management client
KeyClient keyClient = new KeyClientBuilder()
    .vaultUrl("https://<vault-name>.vault.azure.net")
    .credential(new DefaultAzureCredentialBuilder().build())
    .buildClient();

// Async client
KeyAsyncClient keyAsyncClient = new KeyClientBuilder()
    .vaultUrl("https://<vault-name>.vault.azure.net")
    .credential(new DefaultAzureCredentialBuilder().build())
    .buildAsyncClient();

// Cryptography client (for encrypt/decrypt/sign/verify)
CryptographyClient cryptoClient = new CryptographyClientBuilder()
    .keyIdentifier("https://<vault-name>.vault.azure.net/keys/<key-name>/<key-version>")
    .credential(new DefaultAzureCredentialBuilder().build())
    .buildClient();
```

## Key Types

| Type | Description |
|------|-------------|
| `RSA` | RSA key (2048, 3072, 4096 bits) |
| `RSA_HSM` | RSA key in HSM |
| `EC` | Elliptic Curve key |
| `EC_HSM` | Elliptic Curve key in HSM |
| `OCT` | Symmetric key (Managed HSM only) |
| `OCT_HSM` | Symmetric key in HSM |

## Create Keys

### Create RSA Key

```java
import com.azure.security.keyvault.keys.models.*;

// Simple RSA key
KeyVaultKey rsaKey = keyClient.createRsaKey(new CreateRsaKeyOptions("my-rsa-key")
    .setKeySize(2048));

System.out.println("Key name: " + rsaKey.getName());
System.out.println("Key ID: " + rsaKey.getId());
System.out.println("Key type: " + rsaKey.getKeyType());

// RSA key with options
KeyVaultKey rsaKeyWithOptions = keyClient.createRsaKey(new CreateRsaKeyOptions("my-rsa-key-2")
    .setKeySize(4096)
    .setExpiresOn(OffsetDateTime.now().plusYears(1))
    .setNotBefore(OffsetDateTime.now())
    .setEnabled(true)
    .setKeyOperations(KeyOperation.ENCRYPT, KeyOperation.DECRYPT, 
                       KeyOperation.WRAP_KEY, KeyOperation.UNWRAP_KEY)
    .setTags(Map.of("environment", "production")));

// HSM-backed RSA key
KeyVaultKey hsmKey = keyClient.createRsaKey(new CreateRsaKeyOptions("my-hsm-key")
    .setKeySize(2048)
    .setHardwareProtected(true));
```

### Create EC Key

```java
// EC key with P-256 curve
KeyVaultKey ecKey = keyClient.createEcKey(new CreateEcKeyOptions("my-ec-key")
    .setCurveName(KeyCurveName.P_256));

// EC key with other curves
KeyVaultKey ecKey384 = keyClient.createEcKey(new CreateEcKeyOptions("my-ec-key-384")
    .setCurveName(KeyCurveName.P_384));

KeyVaultKey ecKey521 = keyClient.createEcKey(new CreateEcKeyOptions("my-ec-key-521")
    .setCurveName(KeyCurveName.P_521));

// HSM-backed EC key
KeyVaultKey ecHsmKey = keyClient.createEcKey(new CreateEcKeyOptions("my-ec-hsm-key")
    .setCurveName(KeyCurveName.P_256)
    .setHardwareProtected(true));
```

### Create Symmetric Key (Managed HSM only)

```java
KeyVaultKey octKey = keyClient.createOctKey(new CreateOctKeyOptions("my-symmetric-key")
    .setKeySize(256)
    .setHardwareProtected(true));
```

## Get Key

```java
// Get latest version
KeyVaultKey key = keyClient.getKey("my-key");

// Get specific version
KeyVaultKey keyVersion = keyClient.getKey("my-key", "<version-id>");

// Get only key properties (no key material)
KeyProperties keyProps = keyClient.getKey("my-key").getProperties();
```

## Update Key Properties

```java
KeyVaultKey key = keyClient.getKey("my-key");

// Update properties
key.getProperties()
    .setEnabled(false)
    .setExpiresOn(OffsetDateTime.now().plusMonths(6))
    .setTags(Map.of("status", "archived"));

KeyVaultKey updatedKey = keyClient.updateKeyProperties(key.getProperties(),
    KeyOperation.ENCRYPT, KeyOperation.DECRYPT);
```

## List Keys

```java
import com.azure.core.util.paging.PagedIterable;

// List all keys
for (KeyProperties keyProps : keyClient.listPropertiesOfKeys()) {
    System.out.println("Key: " + keyProps.getName());
    System.out.println("  Enabled: " + keyProps.isEnabled());
    System.out.println("  Created: " + keyProps.getCreatedOn());
}

// List key versions
for (KeyProperties version : keyClient.listPropertiesOfKeyVersions("my-key")) {
    System.out.println("Version: " + version.getVersion());
    System.out.println("Created: " + version.getCreatedOn());
}
```

## Delete Key

```java
import com.azure.core.util.polling.SyncPoller;

// Begin delete (soft-delete enabled vaults)
SyncPoller<DeletedKey, Void> deletePoller = keyClient.beginDeleteKey("my-key");

// Wait for deletion
DeletedKey deletedKey = deletePoller.poll().getValue();
System.out.println("Deleted: " + deletedKey.getDeletedOn());

deletePoller.waitForCompletion();

// Purge deleted key (permanent deletion)
keyClient.purgeDeletedKey("my-key");

// Recover deleted key
SyncPoller<KeyVaultKey, Void> recoverPoller = keyClient.beginRecoverDeletedKey("my-key");
recoverPoller.waitForCompletion();
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never move private key material out of the vault: run cryptographic operations through the service
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
