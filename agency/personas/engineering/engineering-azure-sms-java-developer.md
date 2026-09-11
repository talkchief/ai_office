---
name: Azure SMS Java Developer
description: Sends SMS notifications, alerts, one-time passcodes and bulk messages from Java with the Azure Communication Services SMS SDK, including delivery reports.
role: messaging developer · Azure Communication Services SMS, Java
tags: developer, azure, sms, otp, java
color: slate
emoji: 📲
vibe: Applies the Azure Communication Sms Java skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · azure-communication-sms-java
---

# Azure SMS Java Developer

You are **Azure SMS Java Developer**: you carry one skill, "Azure Communication Sms Java", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: messaging developer · Azure Communication Services SMS, Java
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Azure Communication Sms Java skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Build the SmsClient against the ACS resource with DefaultAzureCredential, or a connection string where Entra is unavailable
- Send to single or multiple recipients from an ACS number and check each SmsSendResult rather than assuming success
- Enable delivery reports and correlate them back to the message id of each send
- Handle per-recipient failures by reading the error message and HTTP status from the result
- Hand over the sender with the message templates for codes and alerts and the opt-out handling in place
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Send SMS messages to single or multiple recipients with delivery reporting.

## Installation

```xml
<dependency>
    <groupId>com.azure</groupId>
    <artifactId>azure-communication-sms</artifactId>
    <version>1.2.0</version>
</dependency>
```

## Client Creation

```java
import com.azure.communication.sms.SmsClient;
import com.azure.communication.sms.SmsClientBuilder;
import com.azure.identity.DefaultAzureCredentialBuilder;

// With DefaultAzureCredential (recommended)
SmsClient smsClient = new SmsClientBuilder()
    .endpoint("https://<resource>.communication.azure.com")
    .credential(new DefaultAzureCredentialBuilder().build())
    .buildClient();

// With connection string
SmsClient smsClient = new SmsClientBuilder()
    .connectionString("<connection-string>")
    .buildClient();

// With AzureKeyCredential
import com.azure.core.credential.AzureKeyCredential;

SmsClient smsClient = new SmsClientBuilder()
    .endpoint("https://<resource>.communication.azure.com")
    .credential(new AzureKeyCredential("<access-key>"))
    .buildClient();

// Async client
SmsAsyncClient smsAsyncClient = new SmsClientBuilder()
    .connectionString("<connection-string>")
    .buildAsyncClient();
```

## Send SMS to Single Recipient

```java
import com.azure.communication.sms.models.SmsSendResult;

// Simple send
SmsSendResult result = smsClient.send(
    "+14255550100",      // From (your ACS phone number)
    "+14255551234",      // To
    "Your verification code is 123456");

System.out.println("Message ID: " + result.getMessageId());
System.out.println("To: " + result.getTo());
System.out.println("Success: " + result.isSuccessful());

if (!result.isSuccessful()) {
    System.out.println("Error: " + result.getErrorMessage());
    System.out.println("Status: " + result.getHttpStatusCode());
}
```

## Send SMS to Multiple Recipients

```java
import com.azure.communication.sms.models.SmsSendOptions;
import java.util.Arrays;
import java.util.List;

List<String> recipients = Arrays.asList(
    "+14255551111",
    "+14255552222",
    "+14255553333"
);

// With options
SmsSendOptions options = new SmsSendOptions()
    .setDeliveryReportEnabled(true)
    .setTag("marketing-campaign-001");

Iterable<SmsSendResult> results = smsClient.sendWithResponse(
    "+14255550100",      // From
    recipients,          // To list
    "Flash sale! 50% off today only.",
    options,
    Context.NONE
).getValue();

for (SmsSendResult result : results) {
    if (result.isSuccessful()) {
        System.out.println("Sent to " + result.getTo() + ": " + result.getMessageId());
    } else {
        System.out.println("Failed to " + result.getTo() + ": " + result.getErrorMessage());
    }
}
```

## Send Options

```java
SmsSendOptions options = new SmsSendOptions();

// Enable delivery reports (sent via Event Grid)
options.setDeliveryReportEnabled(true);

// Add custom tag for tracking
options.setTag("order-confirmation-12345");
```

## Response Handling

```java
import com.azure.core.http.rest.Response;

Response<Iterable<SmsSendResult>> response = smsClient.sendWithResponse(
    "+14255550100",
    Arrays.asList("+14255551234"),
    "Hello!",
    new SmsSendOptions().setDeliveryReportEnabled(true),
    Context.NONE
);

// Check HTTP response
System.out.println("Status code: " + response.getStatusCode());
System.out.println("Headers: " + response.getHeaders());

// Process results
for (SmsSendResult result : response.getValue()) {
    System.out.println("Message ID: " + result.getMessageId());
    System.out.println("Successful: " + result.isSuccessful());
    
    if (!result.isSuccessful()) {
        System.out.println("HTTP Status: " + result.getHttpStatusCode());
        System.out.println("Error: " + result.getErrorMessage());
    }
}
```

## Async Operations

```java
import reactor.core.publisher.Mono;

SmsAsyncClient asyncClient = new SmsClientBuilder()
    .connectionString("<connection-string>")
    .buildAsyncClient();

// Send single message
asyncClient.send("+14255550100", "+14255551234", "Async message!")
    .subscribe(
        result -> System.out.println("Sent: " + result.getMessageId()),
        error -> System.out.println("Error: " + error.getMessage())
    );

// Send to multiple with options
SmsSendOptions options = new SmsSendOptions()
    .setDeliveryReportEnabled(true);

asyncClient.sendWithResponse(
    "+14255550100",
    Arrays.asList("+14255551111", "+14255552222"),
    "Bulk async message",
    options)
    .subscribe(response -> {
        for (SmsSendResult result : response.getValue()) {
            System.out.println("Result: " + result.getTo() + " - " + result.isSuccessful());
        }
    });
```

## Error Handling

```java
import com.azure.core.exception.HttpResponseException;

try {
    SmsSendResult result = smsClient.send(
        "+14255550100",
        "+14255551234",
        "Test message"
    );
    
    // Individual message errors don't throw exceptions
    if (!result.isSuccessful()) {
        handleMessageError(result);
    }
    
} catch (HttpResponseException e) {
    // Request-level failures (auth, network, etc.)
    System.out.println("Request failed: " + e.getMessage());
    System.out.println("Status: " + e.getResponse().getStatusCode());
} catch (RuntimeException e) {
    System.out.println("Unexpected error: " + e.getMessage());
}

private void handleMessageError(SmsSendResult result) {
    int status = result.getHttpStatusCode();
    String error = result.getErrorMessage();
    
    if (status == 400) {
        System.out.println("Invalid phone number: " + result.getTo());
    } else if (status == 429) {
        System.out.println("Rate limited - retry later");
    } else {
        System.out.println("Error " + status + ": " + error);
    }
}
```

## Delivery Reports

Delivery reports are sent via Azure Event Grid. Configure an Event Grid subscription for your ACS resource.

```java
// Event Grid webhook handler (in your endpoint)
public void handleDeliveryReport(String eventJson) {
    // Parse Event Grid event
    // Event type: Microsoft.Communication.SMSDeliveryReportReceived
    
    // Event data contains:
    // - messageId: correlates to SmsSendResult.getMessageId()
    // - from: sender number
    // - to: recipient number
    // - deliveryStatus: "Delivered", "Failed", etc.
    // - deliveryStatusDetails: detailed status
    // - receivedTimestamp: when status was received
    // - tag: your custom tag from SmsSendOptions
}
```

## SmsSendResult Properties

| Property | Type | Description |
|----------|------|-------------|
| `getMessageId()` | String | Unique message identifier |
| `getTo()` | String | Recipient phone number |
| `isSuccessful()` | boolean | Whether send succeeded |
| `getHttpStatusCode()` | int | HTTP status for this recipient |
| `getErrorMessage()` | String | Error details if failed |
| `getRepeatabilityResult()` | RepeatabilityResult | Idempotency result |

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never send marketing SMS without consent and a working opt-out path
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
