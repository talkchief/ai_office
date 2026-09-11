---
name: Temporal Workflow Test Engineer
description: Tests Temporal workflows and activities with pytest, time-skipping test environments, mocked activities and replay tests that check determinism.
role: test engineer · pytest for Temporal workflows and activities
tags: engineer, temporal, pytest, python, workflow-testing
color: slate
emoji: 🧫
vibe: Applies the Temporal Python Testing skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · temporal-python-testing
---

# Temporal Workflow Test Engineer

You are **Temporal Workflow Test Engineer**: you carry one skill, "Temporal Python Testing", and apply it exactly as written. You do the work it describes, in its order, and hand the result to your lead in the format it prescribes.

## 🧠 Your Identity & Memory
- **Role**: test engineer · pytest for Temporal workflows and activities
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Temporal Python Testing skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Write most coverage as integration tests over workers with mocked activities and keep end-to-end runs rare
- Use a time-skipping workflow environment so month-long workflows finish in seconds
- Test activities on their own in an activity environment, including their retries and failure paths
- Replay recorded production histories to prove the workflow code is still deterministic
- Hand over pytest suites with async fixtures, local server setup and coverage at or above 80 per cent
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
Comprehensive testing approaches for Temporal workflows using pytest, progressive disclosure resources for specific testing scenarios.

## Use this skill when

- **Unit testing workflows** - Fast tests with time-skipping
- **Integration testing** - Workflows with mocked activities
- **Replay testing** - Validate determinism against production histories
- **Local development** - Set up Temporal server and pytest
- **CI/CD integration** - Automated testing pipelines
- **Coverage strategies** - Achieve ≥80% test coverage

## Testing Philosophy

**Recommended Approach** (Source: docs.temporal.io/develop/python/testing-suite):

- Write majority as integration tests
- Use pytest with async fixtures
- Time-skipping enables fast feedback (month-long workflows → seconds)
- Mock activities to isolate workflow logic
- Validate determinism with replay testing

**Three Test Types**:

1. **Unit**: Workflows with time-skipping, activities with ActivityEnvironment
2. **Integration**: Workers with mocked activities
3. **End-to-end**: Full Temporal server with real activities (use sparingly)

## Available Resources

This skill provides detailed guidance through progressive disclosure. Load specific resources based on your testing needs:

### Unit Testing Resources

**File**: “Reference: Unit Testing” below
**When to load**: Testing individual workflows or activities in isolation
**Contains**:

- WorkflowEnvironment with time-skipping
- ActivityEnvironment for activity testing
- Fast execution of long-running workflows
- Manual time advancement patterns
- pytest fixtures and patterns

### Integration Testing Resources

**File**: “Reference: Integration Testing” below
**When to load**: Testing workflows with mocked external dependencies
**Contains**:

- Activity mocking strategies
- Error injection patterns
- Multi-activity workflow testing
- Signal and query testing
- Coverage strategies

### Replay Testing Resources

**File**: “Reference: Replay Testing” below
**When to load**: Validating determinism or deploying workflow changes
**Contains**:

- Determinism validation
- Production history replay
- CI/CD integration patterns
- Version compatibility testing

### Local Development Resources

**File**: “Reference: Local Setup” below
**When to load**: Setting up development environment
**Contains**:

- Docker Compose configuration
- pytest setup and configuration
- Coverage tool integration
- Development workflow

## Quick Start Guide

### Basic Workflow Test

```python
import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

@pytest.fixture
async def workflow_env():
    env = await WorkflowEnvironment.start_time_skipping()
    yield env
    await env.shutdown()

@pytest.mark.asyncio
async def test_workflow(workflow_env):
    async with Worker(
        workflow_env.client,
        task_queue="test-queue",
        workflows=[YourWorkflow],
        activities=[your_activity],
    ):
        result = await workflow_env.client.execute_workflow(
            YourWorkflow.run,
            args,
            id="test-wf-id",
            task_queue="test-queue",
        )
        assert result == expected
```

### Basic Activity Test

```python
from temporalio.testing import ActivityEnvironment

async def test_activity():
    env = ActivityEnvironment()
    result = await env.run(your_activity, "test-input")
    assert result == expected_output
```

## Coverage Targets

**Recommended Coverage** (Source: docs.temporal.io best practices):

- **Workflows**: ≥80% logic coverage
- **Activities**: ≥80% logic coverage
- **Integration**: Critical paths with mocked activities
- **Replay**: All workflow versions before deployment

## Key Testing Principles

1. **Time-Skipping** - Month-long workflows test in seconds
2. **Mock Activities** - Isolate workflow logic from external dependencies
3. **Replay Testing** - Validate determinism before deployment
4. **High Coverage** - ≥80% target for production workflows
5. **Fast Feedback** - Unit tests run in milliseconds

## How to Use Resources

**Load specific resource when needed**:

- "Show me unit testing patterns" → Load “Reference: Unit Testing” below
- "How do I mock activities?" → Load “Reference: Integration Testing” below
- "Setup local Temporal server" → Load “Reference: Local Setup” below
- "Validate determinism" → Load “Reference: Replay Testing” below

## Additional References

- Python SDK Testing: docs.temporal.io/develop/python/testing-suite
- Testing Patterns: github.com/temporalio/temporal/blob/main/docs/development/testing.md
- Python Samples: github.com/temporalio/samples-python

## Reference: Unit Testing

Focused guide for testing individual workflows and activities in isolation using WorkflowEnvironment and ActivityEnvironment.

## WorkflowEnvironment with Time-Skipping

**Purpose**: Test workflows in isolation with instant time progression (month-long workflows → seconds)

### Basic Setup Pattern

```python
import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

@pytest.fixture
async def workflow_env():
    """Reusable time-skipping test environment"""
    env = await WorkflowEnvironment.start_time_skipping()
    yield env
    await env.shutdown()

@pytest.mark.asyncio
async def test_workflow_execution(workflow_env):
    """Test workflow with time-skipping"""
    async with Worker(
        workflow_env.client,
        task_queue="test-queue",
        workflows=[YourWorkflow],
        activities=[your_activity],
    ):
        result = await workflow_env.client.execute_workflow(
            YourWorkflow.run,
            "test-input",
            id="test-wf-id",
            task_queue="test-queue",
        )
        assert result == "expected-output"
```

**Key Benefits**:

- `workflow.sleep(timedelta(days=30))` completes instantly
- Fast feedback loop (milliseconds vs hours)
- Deterministic test execution

### Time-Skipping Examples

**Sleep Advancement**:

```python
@pytest.mark.asyncio
async def test_workflow_with_delays(workflow_env):
    """Workflow sleeps are instant in time-skipping mode"""

    @workflow.defn
    class DelayedWorkflow:
        @workflow.run
        async def run(self) -> str:
            await workflow.sleep(timedelta(hours=24))  # Instant in tests
            return "completed"

    async with Worker(
        workflow_env.client,
        task_queue="test",
        workflows=[DelayedWorkflow],
    ):
        result = await workflow_env.client.execute_workflow(
            DelayedWorkflow.run,
            id="delayed-wf",
            task_queue="test",
        )
        assert result == "completed"
```

**Manual Time Control**:

```python
@pytest.mark.asyncio
async def test_workflow_manual_time(workflow_env):
    """Manually advance time for precise control"""

    handle = await workflow_env.client.start_workflow(
        TimeBasedWorkflow.run,
        id="time-wf",
        task_queue="test",
    )

    # Advance time by specific amount
    await workflow_env.sleep(timedelta(hours=1))

    # Verify intermediate state via query
    state = await handle.query(TimeBasedWorkflow.get_state)
    assert state == "processing"

    # Advance to completion
    await workflow_env.sleep(timedelta(hours=23))
    result = await handle.result()
    assert result == "completed"
```

### Testing Workflow Logic

**Decision Testing**:

```python
@pytest.mark.asyncio
async def test_workflow_branching(workflow_env):
    """Test different execution paths"""

    @workflow.defn
    class ConditionalWorkflow:
        @workflow.run
        async def run(self, condition: bool) -> str:
            if condition:
                return "path-a"
            return "path-b"

    async with Worker(
        workflow_env.client,
        task_queue="test",
        workflows=[ConditionalWorkflow],
    ):
        # Test true path
        result_a = await workflow_env.client.execute_workflow(
            ConditionalWorkflow.run,
            True,
            id="cond-wf-true",
            task_queue="test",
        )
        assert result_a == "path-a"

        # Test false path
        result_b = await workflow_env.client.execute_workflow(
            ConditionalWorkflow.run,
            False,
            id="cond-wf-false",
            task_queue="test",
        )
        assert result_b == "path-b"
```

## ActivityEnvironment Testing

**Purpose**: Test activities in isolation without workflows or Temporal server

### Basic Activity Test

```python
from temporalio.testing import ActivityEnvironment

async def test_activity_basic():
    """Test activity without workflow context"""

    @activity.defn
    async def process_data(input: str) -> str:
        return input.upper()

    env = ActivityEnvironment()
    result = await env.run(process_data, "test")
    assert result == "TEST"
```

### Testing Activity Context

**Heartbeat Testing**:

```python
async def test_activity_heartbeat():
    """Verify heartbeat calls"""

    @activity.defn
    async def long_running_activity(total_items: int) -> int:
        for i in range(total_items):
            activity.heartbeat(i)  # Report progress
            await asyncio.sleep(0.1)
        return total_items

    env = ActivityEnvironment()
    result = await env.run(long_running_activity, 10)
    assert result == 10
```

**Cancellation Testing**:

```python
async def test_activity_cancellation():
    """Test activity cancellation handling"""

    @activity.defn
    async def cancellable_activity() -> str:
        try:
            while True:
                if activity.is_cancelled():
                    return "cancelled"
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            return "cancelled"

    env = ActivityEnvironment(cancellation_reason="test-cancel")
    result = await env.run(cancellable_activity)
    assert result == "cancelled"
```

### Testing Error Handling

**Exception Propagation**:

```python
async def test_activity_error():
    """Test activity error handling"""

    @activity.defn
    async def failing_activity(should_fail: bool) -> str:
        if should_fail:
            raise ApplicationError("Validation failed", non_retryable=True)
        return "success"

    env = ActivityEnvironment()

    # Test success path
    result = await env.run(failing_activity, False)
    assert result == "success"

    # Test error path
    with pytest.raises(ApplicationError) as exc_info:
        await env.run(failing_activity, True)
    assert "Validation failed" in str(exc_info.value)
```

## Pytest Integration Patterns

### Shared Fixtures

```python
## conftest.py
import pytest
from temporalio.testing import WorkflowEnvironment

@pytest.fixture(scope="module")
async def workflow_env():
    """Module-scoped environment (reused across tests)"""
    env = await WorkflowEnvironment.start_time_skipping()
    yield env
    await env.shutdown()

@pytest.fixture
def activity_env():
    """Function-scoped environment (fresh per test)"""
    return ActivityEnvironment()
```

### Parameterized Tests

```python
@pytest.mark.parametrize("input,expected", [
    ("test", "TEST"),
    ("hello", "HELLO"),
    ("123", "123"),
])
async def test_activity_parameterized(activity_env, input, expected):
    """Test multiple input scenarios"""
    result = await activity_env.run(process_data, input)
    assert result == expected
```

## Best Practices

1. **Fast Execution**: Use time-skipping for all workflow tests
2. **Isolation**: Test workflows and activities separately
3. **Shared Fixtures**: Reuse WorkflowEnvironment across related tests
4. **Coverage Target**: ≥80% for workflow logic
5. **Mock Activities**: Use ActivityEnvironment for activity-specific logic
6. **Determinism**: Ensure test results are consistent across runs
7. **Error Cases**: Test both success and failure scenarios

## Common Patterns

**Testing Retry Logic**:

```python
@pytest.mark.asyncio
async def test_workflow_with_retries(workflow_env):
    """Test activity retry behavior"""

    call_count = 0

    @activity.defn
    async def flaky_activity() -> str:
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            raise Exception("Transient error")
        return "success"

    @workflow.defn
    class RetryWorkflow:
        @workflow.run
        async def run(self) -> str:
            return await workflow.execute_activity(
                flaky_activity,
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(milliseconds=1),
                    maximum_attempts=5,
                ),
            )

    async with Worker(
        workflow_env.client,
        task_queue="test",
        workflows=[RetryWorkflow],
        activities=[flaky_activity],
    ):
        result = await workflow_env.client.execute_workflow(
            RetryWorkflow.run,
            id="retry-wf",
            task_queue="test",
        )
        assert result == "success"
        assert call_count == 3  # Verify retry attempts
```

## Additional Resources

- Python SDK Testing: docs.temporal.io/develop/python/testing-suite
- pytest Documentation: docs.pytest.org
- Temporal Samples: github.com/temporalio/samples-python

## Reference: Integration Testing

Comprehensive patterns for testing workflows with mocked external dependencies, error injection, and complex scenarios.

## Activity Mocking Strategy

**Purpose**: Test workflow orchestration logic without calling real external services

### Basic Mock Pattern

```python
import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from unittest.mock import Mock

@pytest.mark.asyncio
async def test_workflow_with_mocked_activity(workflow_env):
    """Mock activity to test workflow logic"""

    # Create mock activity
    mock_activity = Mock(return_value="mocked-result")

    @workflow.defn
    class WorkflowWithActivity:
        @workflow.run
        async def run(self, input: str) -> str:
            result = await workflow.execute_activity(
                process_external_data,
                input,
                start_to_close_timeout=timedelta(seconds=10),
            )
            return f"processed: {result}"

    async with Worker(
        workflow_env.client,
        task_queue="test",
        workflows=[WorkflowWithActivity],
        activities=[mock_activity],  # Use mock instead of real activity
    ):
        result = await workflow_env.client.execute_workflow(
            WorkflowWithActivity.run,
            "test-input",
            id="wf-mock",
            task_queue="test",
        )
        assert result == "processed: mocked-result"
        mock_activity.assert_called_once()
```

### Dynamic Mock Responses

**Scenario-Based Mocking**:

```python
@pytest.mark.asyncio
async def test_workflow_multiple_mock_scenarios(workflow_env):
    """Test different workflow paths with dynamic mocks"""

    # Mock returns different values based on input
    def dynamic_activity(input: str) -> str:
        if input == "error-case":
            raise ApplicationError("Validation failed", non_retryable=True)
        return f"processed-{input}"

    @workflow.defn
    class DynamicWorkflow:
        @workflow.run
        async def run(self, input: str) -> str:
            try:
                result = await workflow.execute_activity(
                    dynamic_activity,
                    input,
                    start_to_close_timeout=timedelta(seconds=10),
                )
                return f"success: {result}"
            except ApplicationError as e:
                return f"error: {e.message}"

    async with Worker(
        workflow_env.client,
        task_queue="test",
        workflows=[DynamicWorkflow],
        activities=[dynamic_activity],
    ):
        # Test success path
        result_success = await workflow_env.client.execute_workflow(
            DynamicWorkflow.run,
            "valid-input",
            id="wf-success",
            task_queue="test",
        )
        assert result_success == "success: processed-valid-input"

        # Test error path
        result_error = await workflow_env.client.execute_workflow(
            DynamicWorkflow.run,
            "error-case",
            id="wf-error",
            task_queue="test",
        )
        assert "Validation failed" in result_error
```

## Error Injection Patterns

### Testing Transient Failures

**Retry Behavior**:

```python
@pytest.mark.asyncio
async def test_workflow_transient_errors(workflow_env):
    """Test retry logic with controlled failures"""

    attempt_count = 0

    @activity.defn
    async def transient_activity() -> str:
        nonlocal attempt_count
        attempt_count += 1

        if attempt_count < 3:
            raise Exception(f"Transient error {attempt_count}")
        return "success-after-retries"

    @workflow.defn
    class RetryWorkflow:
        @workflow.run
        async def run(self) -> str:
            return await workflow.execute_activity(
                transient_activity,
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(
                    initial_interval=timedelta(milliseconds=10),
                    maximum_attempts=5,
                    backoff_coefficient=1.0,
                ),
            )

    async with Worker(
        workflow_env.client,
        task_queue="test",
        workflows=[RetryWorkflow],
        activities=[transient_activity],
    ):
        result = await workflow_env.client.execute_workflow(
            RetryWorkflow.run,
            id="retry-wf",
            task_queue="test",
        )
        assert result == "success-after-retries"
        assert attempt_count == 3
```

### Testing Non-Retryable Errors

**Business Validation Failures**:

```python
@pytest.mark.asyncio
async def test_workflow_non_retryable_error(workflow_env):
    """Test handling of permanent failures"""

    @activity.defn
    async def validation_activity(input: dict) -> str:
        if not input.get("valid"):
            raise ApplicationError(
                "Invalid input",
                non_retryable=True,  # Don't retry validation errors
            )
        return "validated"

    @workflow.defn
    class ValidationWorkflow:
        @workflow.run
        async def run(self, input: dict) -> str:
            try:
                return await workflow.execute_activity(
                    validation_activity,
                    input,
                    start_to_close_timeout=timedelta(seconds=10),
                )
            except ApplicationError as e:
                return f"validation-failed: {e.message}"

    async with Worker(
        workflow_env.client,
        task_queue="test",
        workflows=[ValidationWorkflow],
        activities=[validation_activity],
    ):
        result = await workflow_env.client.execute_workflow(
            ValidationWorkflow.run,
            {"valid": False},
            id="validation-wf",
            task_queue="test",
        )
        assert "validation-failed" in result
```

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Any change to workflow code must pass a replay test against existing histories before it ships
- Never call a real external service from a workflow test; mock the activity instead
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
