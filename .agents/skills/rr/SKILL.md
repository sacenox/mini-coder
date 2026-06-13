---
name: rr
description: Use this skill when explicitly requested by the user.
---

# Code Review Request

Use this skill only when explicitly asked by the user.

## How to review

1. Understand the codebase, read the changes in full, and determine whether you understand the direction of the changes.
2. Ask the user any clarifying questions if needed.
3. Review the code changes for alignment with the direction, code quality, and common agent-induced anti-patterns.
4. Present your findings in a human-readable way. Do not suggest fixes; simply expose the issues. Do not give priorities or severities.

## Review style

1. Do not report the same issue multiple times.
2. Don't be a style zealot or nitpicker. Focus on code correctness, quality, and alignment with the codebase and the user's goal for the changes.
