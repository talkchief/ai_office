---
name: IT Professional Azure Ai Anomalydetector Java
description: Build anomaly detection applications with Azure AI Anomaly Detector SDK for Java. Use when implementing univariate/multivariate anomaly detection, time-series analysis, or AI-powered monitoring.
color: slate
emoji: 🛠️
vibe: Applies the Azure Ai Anomalydetector Java skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-ai-anomalydetector-java
---

# IT Professional Azure Ai Anomalydetector Java Agent

You are **IT Professional Azure Ai Anomalydetector Java**: you carry one skill, "Azure Ai Anomalydetector Java", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: Azure Ai Anomalydetector Java specialist
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Ai Anomalydetector Java skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Apply the Azure Ai Anomalydetector Java skill to the assignment, step by step, without skipping a step
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute
- Cite the skill by name in the report so the lead knows which method was applied

## 📋 The skill, as written
# Azure AI Anomaly Detector SDK for Java

Build anomaly detection applications using the Azure AI Anomaly Detector SDK for Java.

## Installation

```xml
<dependency>
  <groupId>com.azure</groupId>
  <artifactId>azure-ai-anomalydetector</artifactId>
  <version>3.0.0-beta.6</version>
</dependency>
```

## Client Creation

### Sync and Async Clients

```java
import com.azure.ai.anomalydetector.AnomalyDetectorClientBuilder;
import com.azure.ai.anomalydetector.MultivariateClient;
import com.azure.ai.anomalydetector.UnivariateClient;
import com.azure.core.credential.AzureKeyCredential;

String endpoint = System.getenv("AZURE_ANOMALY_DETECTOR_ENDPOINT");
String key = System.getenv("AZURE_ANOMALY_DETECTOR_API_KEY");

// Multivariate client for multiple correlated signals
MultivariateClient multivariateClient = new AnomalyDetectorClientBuilder()
    .credential(new AzureKeyCredential(key))
    .endpoint(endpoint)
    .buildMultivariateClient();

// Univariate client for single variable analysis
UnivariateClient univariateClient = new AnomalyDetectorClientBuilder()
    .credential(new AzureKeyCredential(key))
    .endpoint(endpoint)
    .buildUnivariateClient();
```

### With DefaultAzureCredential

```java
import com.azure.identity.DefaultAzureCredentialBuilder;

MultivariateClient client = new AnomalyDetectorClientBuilder()
    .credential(new DefaultAzureCredentialBuilder().build())
    .endpoint(endpoint)
    .buildMultivariateClient();
```

## Key Concepts

### Univariate Anomaly Detection
- **Batch Detection**: Analyze entire time series at once
- **Streaming Detection**: Real-time detection on latest data point
- **Change Point Detection**: Detect trend changes in time series

### Multivariate Anomaly Detection
- Detect anomalies across 300+ correlated signals
- Uses Graph Attention Network for inter-correlations
- Three-step process: Train → Inference → Results

## Core Patterns

### Univariate Batch Detection

```java
import com.azure.ai.anomalydetector.models.*;
import java.time.OffsetDateTime;
import java.util.List;

List<TimeSeriesPoint> series = List.of(
    new TimeSeriesPoint(OffsetDateTime.parse("2023-01-01T00:00:00Z"), 1.0),
    new TimeSeriesPoint(OffsetDateTime.parse("2023-01-02T00:00:00Z"), 2.5),
    // ... more data points (minimum 12 points required)
);

UnivariateDetectionOptions options = new UnivariateDetectionOptions(series)
    .setGranularity(TimeGranularity.DAILY)
    .setSensitivity(95);

UnivariateEntireDetectionResult result = univariateClient.detectUnivariateEntireSeries(options);

// Check for anomalies
for (int i = 0; i < result.getIsAnomaly().size(); i++) {
    if (result.getIsAnomaly().get(i)) {
        System.out.printf("Anomaly detected at index %d with value %.2f%n",
            i, series.get(i).getValue());
    }
}
```

### Univariate Last Point Detection (Streaming)

```java
UnivariateLastDetectionResult lastResult = univariateClient.detectUnivariateLastPoint(options);

if (lastResult.isAnomaly()) {
    System.out.println("Latest point is an anomaly!");
    System.out.printf("Expected: %.2f, Upper: %.2f, Lower: %.2f%n",
        lastResult.getExpectedValue(),
        lastResult.getUpperMargin(),
        lastResult.getLowerMargin());
}
```

### Change Point Detection

```java
UnivariateChangePointDetectionOptions changeOptions = 
    new UnivariateChangePointDetectionOptions(series, TimeGranularity.DAILY);

UnivariateChangePointDetectionResult changeResult = 
    univariateClient.detectUnivariateChangePoint(changeOptions);

for (int i = 0; i < changeResult.getIsChangePoint().size(); i++) {
    if (changeResult.getIsChangePoint().get(i)) {
        System.out.printf("Change point at index %d with confidence %.2f%n",
            i, changeResult.getConfidenceScores().get(i));
    }
}
```

### Multivariate Model Training

```java
import com.azure.ai.anomalydetector.models.*;
import com.azure.core.util.polling.SyncPoller;

// Prepare training request with blob storage data
ModelInfo modelInfo = new ModelInfo()
    .setDataSource("https://storage.blob.core.windows.net/container/data.zip?sasToken")
    .setStartTime(OffsetDateTime.parse("2023-01-01T00:00:00Z"))
    .setEndTime(OffsetDateTime.parse("2023-06-01T00:00:00Z"))
    .setSlidingWindow(200)
    .setDisplayName("MyMultivariateModel");

// Train model (long-running operation)
AnomalyDetectionModel trainedModel = multivariateClient.trainMultivariateModel(modelInfo);

String modelId = trainedModel.getModelId();
System.out.println("Model ID: " + modelId);

// Check training status
AnomalyDetectionModel model = multivariateClient.getMultivariateModel(modelId);
System.out.println("Status: " + model.getModelInfo().getStatus());
```

### Multivariate Batch Inference

```java
MultivariateBatchDetectionOptions detectionOptions = new MultivariateBatchDetectionOptions()
    .setDataSource("https://storage.blob.core.windows.net/container/inference-data.zip?sasToken")
    .setStartTime(OffsetDateTime.parse("2023-07-01T00:00:00Z"))
    .setEndTime(OffsetDateTime.parse("2023-07-31T00:00:00Z"))
    .setTopContributorCount(10);

MultivariateDetectionResult detectionResult = 
    multivariateClient.detectMultivariateBatchAnomaly(modelId, detectionOptions);

String resultId = detectionResult.getResultId();

// Poll for results
MultivariateDetectionResult result = multivariateClient.getBatchDetectionResult(resultId);
for (AnomalyState state : result.getResults()) {
    if (state.getValue().isAnomaly()) {
        System.out.printf("Anomaly at %s, severity: %.2f%n",
            state.getTimestamp(),
            state.getValue().getSeverity());
    }
}
```

### Multivariate Last Point Detection

```java
MultivariateLastDetectionOptions lastOptions = new MultivariateLastDetectionOptions()
    .setVariables(List.of(
        new VariableValues("variable1", List.of("timestamp1"), List.of(1.0f)),
        new VariableValues("variable2", List.of("timestamp1"), List.of(2.5f))
    ))
    .setTopContributorCount(5);

MultivariateLastDetectionResult lastResult = 
    multivariateClient.detectMultivariateLastAnomaly(modelId, lastOptions);

if (lastResult.getValue().isAnomaly()) {
    System.out.println("Anomaly detected!");
    // Check contributing variables
    for (AnomalyContributor contributor : lastResult.getValue().getInterpretation()) {
        System.out.printf("Variable: %s, Contribution: %.2f%n",
            contributor.getVariable(),
            contributor.getContributionScore());
    }
}
```

### Model Management

```java
// List all models
PagedIterable<AnomalyDetectionModel> models = multivariateClient.listMultivariateModels();
for (AnomalyDetectionModel m : models) {
    System.out.printf("Model: %s, Status: %s%n",
        m.getModelId(),
        m.getModelInfo().getStatus());
}

// Delete a model
mul

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
