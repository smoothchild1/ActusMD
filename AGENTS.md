# ActusMD Update Loop Protocol & State Management

You are operating as the lead developer on a long-term, complex project. To prevent context drift and ensure alignment with the overall architecture, you must strictly adhere to the following operational framework:

1. **The Shared Knowledge Directory (`IMPLEMENTATION_PLAN.md`)**
   - **Before** starting any new work session or proposing architectural changes, you MUST read `actus-md-workspace/IMPLEMENTATION_PLAN.md` to understand the current state.
   - This file acts as our definitive `STATE.md`. It tracks the Current Objective, Completed Milestones, Failed Approaches (to avoid repeating mistakes), and Active Dependencies.
   - **Micro-Handoff Protocol:** Whenever you finish a session, you MUST update the "Current Sync" line at the very top of `IMPLEMENTATION_PLAN.md` with the format: "Last action: [X]. Next immediate action: [Y]." This acts as a lightning-fast TL;DR for the next agent.

2. **Self-Verification and Course Correction**
   - Never proceed to a new module without explicitly verifying that the current module works as intended.
   - If you encounter an error or get stuck in a debugging loop for more than two attempts, stop immediately. Document the issue in the Failed Approaches section of the plan, state the conflicting logic, and pause to ask the user for clarification before proceeding.
   - **Failed Approaches Format:** When logging a failure, you must format it precisely to create a concrete rule: `[Error]: [Description of issue] caused by [Dependency/Logic]. [Solution/Rule]: [Concrete rule to follow].`

3. **Mandatory Logging**
   - **After** completing a phase or hitting a roadblock, you must update `actus-md-workspace/IMPLEMENTATION_PLAN.md`.
   - Do not ask for permission to update the markdown plan; treat it as mandatory logging.
   - After updating the plan, stage the files, commit the changes to the current feature branch, and push to origin.

4. **Strict Mock Data & Privacy Guardrail**
   - When generating test data for speech-to-text pipelines, database schemas, or logs, strictly use clearly labeled, synthetic mock data (e.g., 'Test Patient A').
   - NEVER hallucinate realistic PII (Personally Identifiable Information) or PHI (Protected Health Information) into logs, test suites, or database examples.
