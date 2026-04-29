# Human's TODO list.

> This file is managed by the user, only edit if asked to.

## TODO: Better prompts, tools descriptions and reminder prompt engineering.

Raw notes, references:

> good lessons from claude and general advice, seems good and grounded on real experience. Matches with learnings.
https://www.indiehackers.com/post/the-complete-guide-to-writing-agent-system-prompts-lessons-from-reverse-engineering-claude-code-6e18d54294

> How pi coding agent does it, minimal and structured, a good approach, but we can be even more focused and minimal.
https://raw.githubusercontent.com/badlogic/pi-mono/refs/heads/main/packages/coding-agent/src/core/system-prompt.ts

> Key sentence to add:
```
Prioritize technical accuracy and truthfulness over validating the user's beliefs.
Focus on facts and problem-solving, providing direct, objective technical info
without any unnecessary superlatives, praise, or emotional validation.
```

---

# [Agent Name] Agent Prompt

## Role
[Define the agent's role, persona, and objective concisely.]
Example: You are an expert Data Analyst. You write SQL queries to answer questions from the marketing department.

## Tool Usage
[Provide supplementary instructions on how/when to use specific tools.]
*Note: Detailed technical specifications should be defined in the tool's description settings, but high-level logic goes here.*

## Input / Output
### Input Variables
- `{{variable_name}}`: [Description of the variable]

### Output Goals
- [Definition of the final deliverable]

## Task Flow
1. [Task Name]
   - [Specific steps and decision criteria]
2. [Task Name]
   - [Specific steps and decision criteria]

## Constraints & Rules
- [Prohibitions and constraints]
- [Tone and Manner instructions]

---

# The Six Prompting Techniques That Power Modern Coding Agents

I've been teaching a class at Stanford on AI-based software development practices and put together a lecture on the essential prompting techniques every
software developer should know. Thought this would be helpful for the community:

**K-shot:** Ask the LLM to do a task but provide examples of how to do it. Best when dealing with languages or frameworks that the LLM may not have seen
in its training data. Experiment with the number of examples to use but 1-5 is usually quite performant.

```text
BEFORE:
Write a for-loop iterating over a list of strings using the naming convention in our repo.

AFTER:
Write a for-loop iterating over a list of strings using the naming convention in our repo. Here are some examples of how we typically format variable
names. <example> var StRaRrAy = [‘cat’, ‘dog’, ‘wombat’] </example> <example> def func CaPiTaLiZeStR = () => {} </example>
```

**Chain-of-thought:** Ask an LLM to do a task but prompt it to show its reasoning steps by either providing examples of logical traces or asking it to
"think step-by-step."

```text
BEFORE:
Write a function to check if a number is a perfect cube and a perfect square.

AFTER:
I want to write a function to check if a number is a perfect cube and a perfect square. Make sure to provide your reasoning first. Here are some examples
of how to provide reasoning for a coding task. <example> Write a function that finds the maximum element in a list. Steps: Initialize a variable with the
first element. Traverse the list, comparing… </example> <example> Write a function that checks is a number is a palindrome Steps: Take the number. Reverse
the elements in the numbers. Check if … </example
```

**Self-consistency.** Ask an LLM to do a task but prompt it to produce multiple outputs and then take the majority output. To use a traditional machine
learning analogy, this is like an LLM form of model ensembling.

```text
BEFORE:
What’s the root cause for this error: Traceback (most recent call last): File "example.py", line 3, in <module> print(nums[i]) IndexError: list index out
of range

AFTER:
What’s the root cause for this error: Traceback (most recent call last): File "example.py", line 3, in <module> print(nums[i]) IndexError: list index out
of range --> Prompt 5x
--> Take majority result
```

**Tool-use.** Allows an LLM to interact with the real-world by querying APIs, external data sources, and other resources. Helps reduce LLM hallucinations
and make them more fully autonomous.

```text
BEFORE:
After you have fixed this IndexError can you ensure that the CI tests still pass?

AFTER:
Fix the IndexError. Ensure the CI tests still pass once you have made the fix. Here are the available tools. <tools> pytest -s /path/to/unit_tests pytest
-v /path/to/integration_tests </tools>
```

**Retrieval Augmented Generation.** Infuses the LLM with relevant contextual data like source files, functions, and symbols from code. Also provides
interpretability and citations in responses. This is one of the most commonly used techniques in modern AI coding platforms like Windsurf, Cursor, Claude
Code.

```text
BEFORE:
Extend the UserAuthService class to check that the client provides a valid OAuth token.

AFTER:
I want to extend the UserAuthService class to check that the client provides a valid OAuth token. Here is how the UserAuthService works now:
<code_snippet> def issue_oauth_token(): …. </code_snippet> Here is the path to the requests-oauthlib documentation: <url>
https://requests-oauthlib.readthedocs.io/en/latest/</url>
```

**Reflexion.** Have an LLM reflect on its output after performing a task, then feed its reflection on what it observes back to it for a follow-on prompt.

```text
BEFORE:
Ensure that the company_location column can handle string and json representations.

AFTER:
Extend the logic for company_location to be able to handle string and json representations
--> OBSERVE
The unit tests for the company_location type aren’t passing.
--> REFLECT
It appears that the unit tests for company_location are throwing a JSONDecodeError.
--> EXTEND PROMPT
I am extending the company_location column. I must ensure that when a string is provided as input it doesn’t throw a JSONDecodeError.
```