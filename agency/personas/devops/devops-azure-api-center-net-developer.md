---
name: Azure API Center .NET Developer
description: Automates a central API inventory in Azure API Center from .NET, registering APIs, versions and definitions for governance and discovery.
role: API governance developer · Azure API Center, C#
tags: developer, azure, api-governance, api-center, dotnet
color: slate
emoji: 📚
vibe: Applies the Azure Mgmt Apicenter .NET skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-mgmt-apicenter-dotnet
---

# Azure API Center .NET Developer

You are **Azure API Center .NET Developer**: you carry one skill, "Azure Mgmt Apicenter .NET", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: API governance developer · Azure API Center, C#
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Mgmt Apicenter .NET skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Authenticate with the default Azure credential and read the service name and resource group from the environment
- Create the API Center service with a managed identity, then organise APIs into workspaces
- Register each API with its title, kind, lifecycle stage, contacts and terms so the inventory is usable
- Attach versions and definitions and record which environment each deployment targets
- Hand over the C# with the metadata schema it assumes and the inventory it produces
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Centralized API inventory and governance SDK for managing APIs across your organization.

## Installation

```bash
dotnet add package Azure.ResourceManager.ApiCenter
dotnet add package Azure.Identity
```

**Current Version**: v1.0.0 (GA)  
**API Version**: 2024-03-01

## Environment Variables

```bash
AZURE_SUBSCRIPTION_ID=<your-subscription-id>
AZURE_RESOURCE_GROUP=<your-resource-group>
AZURE_APICENTER_SERVICE_NAME=<your-apicenter-service>
```

## Authentication

```csharp
using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.ApiCenter;

ArmClient client = new ArmClient(new DefaultAzureCredential());
```

## Resource Hierarchy

```
Subscription
└── ResourceGroup
    └── ApiCenterService                    # API inventory service
        ├── Workspace                       # Logical grouping of APIs
        │   ├── Api                         # API definition
        │   │   └── ApiVersion              # Version of the API
        │   │       └── ApiDefinition       # OpenAPI/GraphQL/etc specification
        │   ├── Environment                 # Deployment target (dev/staging/prod)
        │   └── Deployment                  # API deployed to environment
        └── MetadataSchema                  # Custom metadata definitions
```

## Core Workflows

### 1. Create API Center Service

```csharp
using Azure.ResourceManager.ApiCenter;
using Azure.ResourceManager.ApiCenter.Models;

ResourceGroupResource resourceGroup = await client
    .GetDefaultSubscriptionAsync()
    .Result
    .GetResourceGroupAsync("my-resource-group");

ApiCenterServiceCollection services = resourceGroup.GetApiCenterServices();

ApiCenterServiceData data = new ApiCenterServiceData(AzureLocation.EastUS)
{
    Identity = new ManagedServiceIdentity(ManagedServiceIdentityType.SystemAssigned)
};

ArmOperation<ApiCenterServiceResource> operation = await services
    .CreateOrUpdateAsync(WaitUntil.Completed, "my-api-center", data);

ApiCenterServiceResource service = operation.Value;
```

### 2. Create Workspace

```csharp
ApiCenterWorkspaceCollection workspaces = service.GetApiCenterWorkspaces();

ApiCenterWorkspaceData workspaceData = new ApiCenterWorkspaceData
{
    Title = "Engineering APIs",
    Description = "APIs owned by the engineering team"
};

ArmOperation<ApiCenterWorkspaceResource> operation = await workspaces
    .CreateOrUpdateAsync(WaitUntil.Completed, "engineering", workspaceData);

ApiCenterWorkspaceResource workspace = operation.Value;
```

### 3. Create API

```csharp
ApiCenterApiCollection apis = workspace.GetApiCenterApis();

ApiCenterApiData apiData = new ApiCenterApiData
{
    Title = "Orders API",
    Description = "API for managing customer orders",
    Kind = ApiKind.Rest,
    LifecycleStage = ApiLifecycleStage.Production,
    TermsOfService = new ApiTermsOfService
    {
        Uri = new Uri("https://example.com/terms")
    },
    ExternalDocumentation = 
    {
        new ApiExternalDocumentation
        {
            Title = "Documentation",
            Uri = new Uri("https://docs.example.com/orders")
        }
    },
    Contacts =
    {
        new ApiContact
        {
            Name = "API Support",
            Email = "api-support@example.com"
        }
    }
};

// Add custom metadata
apiData.CustomProperties = BinaryData.FromObjectAsJson(new
{
    team = "orders-team",
    costCenter = "CC-1234"
});

ArmOperation<ApiCenterApiResource> operation = await apis
    .CreateOrUpdateAsync(WaitUntil.Completed, "orders-api", apiData);

ApiCenterApiResource api = operation.Value;
```

### 4. Create API Version

```csharp
ApiCenterApiVersionCollection versions = api.GetApiCenterApiVersions();

ApiCenterApiVersionData versionData = new ApiCenterApiVersionData
{
    Title = "v1.0.0",
    LifecycleStage = ApiLifecycleStage.Production
};

ArmOperation<ApiCenterApiVersionResource> operation = await versions
    .CreateOrUpdateAsync(WaitUntil.Completed, "v1-0-0", versionData);

ApiCenterApiVersionResource version = operation.Value;
```

### 5. Create API Definition (Upload OpenAPI Spec)

```csharp
ApiCenterApiDefinitionCollection definitions = version.GetApiCenterApiDefinitions();

ApiCenterApiDefinitionData definitionData = new ApiCenterApiDefinitionData
{
    Title = "OpenAPI Specification",
    Description = "Orders API OpenAPI 3.0 definition"
};

ArmOperation<ApiCenterApiDefinitionResource> operation = await definitions
    .CreateOrUpdateAsync(WaitUntil.Completed, "openapi", definitionData);

ApiCenterApiDefinitionResource definition = operation.Value;

// Import specification
string openApiSpec = await File.ReadAllTextAsync("orders-api.yaml");

ApiSpecImportContent importContent = new ApiSpecImportContent
{
    Format = ApiSpecImportSourceFormat.Inline,
    Value = openApiSpec,
    Specification = new ApiSpecImportSpecification
    {
        Name = "openapi",
        Version = "3.0.1"
    }
};

await definition.ImportSpecificationAsync(WaitUntil.Completed, importContent);
```

### 6. Export API Specification

```csharp
ApiCenterApiDefinitionResource definition = await client
    .GetApiCenterApiDefinitionResource(definitionResourceId)
    .GetAsync();

ArmOperation<ApiSpecExportResult> operation = await definition
    .ExportSpecificationAsync(WaitUntil.Completed);

ApiSpecExportResult result = operation.Value;

// result.Format - e.g., "inline"
// result.Value - the specification content
```

### 7. Create Environment

```csharp
ApiCenterEnvironmentCollection environments = workspace.GetApiCenterEnvironments();

ApiCenterEnvironmentData envData = new ApiCenterEnvironmentData
{
    Title = "Production",
    Description = "Production environment",
    Kind = ApiCenterEnvironmentKind.Production,
    Server = new ApiCenterEnvironmentServer
    {
        ManagementPortalUris = { new Uri("https://portal.azure.com") }
    },
    Onboarding = new EnvironmentOnboardingModel
    {
        Instructions = "Contact platform team for access",
        DeveloperPortalUris = { new Uri("https://developer.example.com") }
    }
};

ArmOperation<ApiCenterEnvironmentResource> operation = await environments
    .CreateOrUpdateAsync(WaitUntil.Completed, "production", envData);
```

### 8. Create Deployment

```csharp
ApiCenterDeploymentCollection deployments = workspace.GetApiCenterDeployments();

// Get environment resource ID
ResourceIdentifier envResourceId = ApiCenterEnvironmentResource.CreateResourceIdentifier(
    subscriptionId, resourceGroupName, serviceName, workspaceName, "production");

// Get API definition resource ID
ResourceIdentifier definitionResourceId = ApiCenterApiDefinitionResource.CreateResourceIdentifier(
    subscriptionId, resourceGroupName, serviceName, workspaceName, 
    "orders-api", "v1-0-0", "openapi");

ApiCenterDeploymentData deploymentData = new ApiCenterDeploymentData
{
    Title = "Orders API - Production",
    Description = "Production deployment of Orders API v1.0.0",
    EnvironmentId = envResourceId,
    DefinitionId = definitionResourc

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
