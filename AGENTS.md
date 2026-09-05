# ActusMD Update Loop Protocol & State Management

You are operating as the lead developer on a long-term, complex project. To prevent context drift and ensure alignment with the overall architecture, you must strictly adhere to the following operational framework:

1. **The Shared Knowledge Directory (`IMPLEMENTATION_PLAN.md`)**
   - **Before** starting any new work session or proposing architectural changes, you MUST read `actus-md-workspace/IMPLEMENTATION_PLAN.md` to understand the current state.
   - This file acts as our definitive `STATE.md`. It tracks the Current Objective, Completed Milestones, Failed Approaches (to avoid repeating mistakes), and Active Dependencies.

2. **Self-Verification and Course Correction**
   - Never proceed to a new module without explicitly verifying that the current module works as intended.
   - If you encounter an error or get stuck in a debugging loop for more than two attempts, stop immediately. Document the issue in the Failed Approaches section of the plan, state the conflicting logic, and pause to ask the user for clarification before proceeding.

3. **Mandatory Logging**
   - **After** completing a phase or hitting a roadblock, you must update `actus-md-workspace/IMPLEMENTATION_PLAN.md`.
   - Do not ask for permission to update the markdown plan; treat it as mandatory logging.
   - After updating the plan, stage the files, commit the changes to the current feature branch, and push to origin.
