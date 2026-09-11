---
name: Azure Batch HPC Developer
description: Runs large-scale parallel and HPC workloads from Java with the Azure Batch SDK, managing pools, jobs, tasks and compute nodes.
role: HPC developer · Azure Batch pools, jobs, tasks, Java
tags: developer, azure, hpc, batch, java
color: slate
emoji: 🧮
vibe: Applies the Azure Compute Batch Java skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-compute-batch-java
---

# Azure Batch HPC Developer

You are **Azure Batch HPC Developer**: you carry one skill, "Azure Compute Batch Java", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: HPC developer · Azure Batch pools, jobs, tasks, Java
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Compute Batch Java skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Authenticate the Batch client with Entra ID rather than a shared account key wherever it is possible
- Size the pool for the job: node type, node count, and whether the work suits low-priority nodes
- Structure the work as jobs and tasks, with resource files going in and output files coming back out
- Use the asynchronous client when many tasks are submitted or monitored at once
- Hand over the Java with the pool, job and task definitions and how to watch them run to completion
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Client library for running large-scale parallel and high-performance computing (HPC) batch jobs in Azure.

## Installation

```xml
<dependency>
    <groupId>com.azure</groupId>
    <artifactId>azure-compute-batch</artifactId>
    <version>1.0.0-beta.5</version>
</dependency>
```

## Prerequisites

- Azure Batch account
- Pool configured with compute nodes
- Azure subscription

## Environment Variables

```bash
AZURE_BATCH_ENDPOINT=https://<account>.<region>.batch.azure.com
AZURE_BATCH_ACCOUNT=<account-name>
AZURE_BATCH_ACCESS_KEY=<account-key>
```

## Client Creation

### With Microsoft Entra ID (Recommended)

```java
import com.azure.compute.batch.BatchClient;
import com.azure.compute.batch.BatchClientBuilder;
import com.azure.identity.DefaultAzureCredentialBuilder;

BatchClient batchClient = new BatchClientBuilder()
    .credential(new DefaultAzureCredentialBuilder().build())
    .endpoint(System.getenv("AZURE_BATCH_ENDPOINT"))
    .buildClient();
```

### Async Client

```java
import com.azure.compute.batch.BatchAsyncClient;

BatchAsyncClient batchAsyncClient = new BatchClientBuilder()
    .credential(new DefaultAzureCredentialBuilder().build())
    .endpoint(System.getenv("AZURE_BATCH_ENDPOINT"))
    .buildAsyncClient();
```

### With Shared Key Credentials

```java
import com.azure.core.credential.AzureNamedKeyCredential;

String accountName = System.getenv("AZURE_BATCH_ACCOUNT");
String accountKey = System.getenv("AZURE_BATCH_ACCESS_KEY");
AzureNamedKeyCredential sharedKeyCreds = new AzureNamedKeyCredential(accountName, accountKey);

BatchClient batchClient = new BatchClientBuilder()
    .credential(sharedKeyCreds)
    .endpoint(System.getenv("AZURE_BATCH_ENDPOINT"))
    .buildClient();
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| Pool | Collection of compute nodes that run tasks |
| Job | Logical grouping of tasks |
| Task | Unit of computation (command/script) |
| Node | VM that executes tasks |
| Job Schedule | Recurring job creation |

## Pool Operations

### Create Pool

```java
import com.azure.compute.batch.models.*;

batchClient.createPool(new BatchPoolCreateParameters("myPoolId", "STANDARD_DC2s_V2")
    .setVirtualMachineConfiguration(
        new VirtualMachineConfiguration(
            new BatchVmImageReference()
                .setPublisher("Canonical")
                .setOffer("UbuntuServer")
                .setSku("22_04-lts")
                .setVersion("latest"),
            "batch.node.ubuntu 22.04"))
    .setTargetDedicatedNodes(2)
    .setTargetLowPriorityNodes(0), null);
```

### Get Pool

```java
BatchPool pool = batchClient.getPool("myPoolId");
System.out.println("Pool state: " + pool.getState());
System.out.println("Current dedicated nodes: " + pool.getCurrentDedicatedNodes());
```

### List Pools

```java
import com.azure.core.http.rest.PagedIterable;

PagedIterable<BatchPool> pools = batchClient.listPools();
for (BatchPool pool : pools) {
    System.out.println("Pool: " + pool.getId() + ", State: " + pool.getState());
}
```

### Resize Pool

```java
import com.azure.core.util.polling.SyncPoller;

BatchPoolResizeParameters resizeParams = new BatchPoolResizeParameters()
    .setTargetDedicatedNodes(4)
    .setTargetLowPriorityNodes(2);

SyncPoller<BatchPool, BatchPool> poller = batchClient.beginResizePool("myPoolId", resizeParams);
poller.waitForCompletion();
BatchPool resizedPool = poller.getFinalResult();
```

### Enable AutoScale

```java
BatchPoolEnableAutoScaleParameters autoScaleParams = new BatchPoolEnableAutoScaleParameters()
    .setAutoScaleEvaluationInterval(Duration.ofMinutes(5))
    .setAutoScaleFormula("$TargetDedicatedNodes = min(10, $PendingTasks.GetSample(TimeInterval_Minute * 5));");

batchClient.enablePoolAutoScale("myPoolId", autoScaleParams);
```

### Delete Pool

```java
SyncPoller<BatchPool, Void> deletePoller = batchClient.beginDeletePool("myPoolId");
deletePoller.waitForCompletion();
```

## Job Operations

### Create Job

```java
batchClient.createJob(
    new BatchJobCreateParameters("myJobId", new BatchPoolInfo().setPoolId("myPoolId"))
        .setPriority(100)
        .setConstraints(new BatchJobConstraints()
            .setMaxWallClockTime(Duration.ofHours(24))
            .setMaxTaskRetryCount(3)),
    null);
```

### Get Job

```java
BatchJob job = batchClient.getJob("myJobId", null, null);
System.out.println("Job state: " + job.getState());
```

### List Jobs

```java
PagedIterable<BatchJob> jobs = batchClient.listJobs(new BatchJobsListOptions());
for (BatchJob job : jobs) {
    System.out.println("Job: " + job.getId() + ", State: " + job.getState());
}
```

### Get Task Counts

```java
BatchTaskCountsResult counts = batchClient.getJobTaskCounts("myJobId");
System.out.println("Active: " + counts.getTaskCounts().getActive());
System.out.println("Running: " + counts.getTaskCounts().getRunning());
System.out.println("Completed: " + counts.getTaskCounts().getCompleted());
```

### Terminate Job

```java
BatchJobTerminateParameters terminateParams = new BatchJobTerminateParameters()
    .setTerminationReason("Manual termination");
BatchJobTerminateOptions options = new BatchJobTerminateOptions().setParameters(terminateParams);

SyncPoller<BatchJob, BatchJob> poller = batchClient.beginTerminateJob("myJobId", options, null);
poller.waitForCompletion();
```

### Delete Job

```java
SyncPoller<BatchJob, Void> deletePoller = batchClient.beginDeleteJob("myJobId");
deletePoller.waitForCompletion();
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Read the Batch endpoint and account credentials from environment variables, never from source
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
