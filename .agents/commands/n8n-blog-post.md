---
description: Trigger the n8n workflow to create a blog post using title and content as seeds.
model: zen/claude-haiku-4-5
context: fork
---


Arguments: $ARGUMENTS

Make a GET cURL request to the URL in the `$N8N_BLOG_WEBHOOK_URL` env var with query string params `title` and `content`. Pass the values exactly as given — do not expand or rewrite the content.

If `title` or `content` are not explicitly provided, infer them from the arguments given.

Print the response body after the request completes.

