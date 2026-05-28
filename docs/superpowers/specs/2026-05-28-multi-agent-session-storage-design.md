# Multi-Agent Session Storage Design

## Summary

Replace the current runtime chat model of "one persisted chat per agent" with a session-centric model where one session contains the chat history for all agents involved in the task.

Under the new design:

- Runtime chat state is keyed by `currentSessionId`.
- Each session contains a per-agent message collection under `session.agents`.
- The left agent list switches the visible agent within the current session instead of switching persisted chat stores.
- Clicking `SAVE` stores the entire current session as one saved session.
- Loading an older session first auto-saves the current session if it is non-empty and has unsaved changes, then restores the selected session.

This design matches the intended behavior that one saved session represents one complete multi-agent task conversation.

## Goals

- Make one saved session represent one complete task across all agents.
- Allow switching agents to inspect each agent's messages within the same session.
- Preserve current work by auto-saving before restoring another session.
- Avoid overwriting existing saved sessions.
- Keep old saved data readable during transition.

## Non-Goals

- Redesign the agent collaboration protocol.
- Redesign the message rendering format.
- Introduce branching version history inside a single session.
- Preserve `chat_<agentId>` as the long-term primary runtime source of truth.

## Current Problem

The current system stores runtime and saved chat around individual agents:

- Runtime chat persistence is primarily organized as `chat_<agentId>` and disk files per agent.
- `SAVE` stores only the current agent's messages as one session.
- Switching agents changes which independent chat history is shown.

This causes a mismatch between user intent and stored data:

- A task involving multiple agents is fragmented across several agent histories.
- A saved session does not represent the whole task.
- Restoring a saved item does not naturally restore the full multi-agent context.

## Proposed Model

## Session As Primary Unit

The new primary unit is a session object. A session owns all messages for all agents that participated in the task.

Example shape:

```js
{
  id: "sess_1779980000000",
  title: "FIX SAVE TO STORE ALL AGENTS",
  createdAt: 1779980000000,
  savedAt: 1779981234567,
  lastActiveAgentId: "architect",
  dirty: false,
  agents: {
    architect: {
      agentId: "architect",
      agentName: "ARCHITECT",
      messages: [...]
    },
    debugger: {
      agentId: "debugger",
      agentName: "DEBUGGER",
      messages: [...]
    }
  }
}
```

## Runtime State

Runtime state should move from agent-centric persistence to session-centric persistence:

- `currentSessionId` identifies the active runtime session.
- `currentSession` is the active in-memory session object.
- `currentAgentId` continues to control which agent's messages are visible.
- `currentAgentId` no longer selects an independent persisted chat history. It selects a view into `currentSession.agents[agentId]`.

Expected consequences:

- Sending a user message to the current agent appends to that agent's messages in the current session.
- Background agent collaboration also appends into the same current session under the relevant agent nodes.
- Switching the visible agent does not change the session. It changes only the displayed subsection of the same session.

## Session Lifecycle

## New Runtime Session

At app start, the system should ensure one runtime session exists.

Rules:

- If a current runtime session exists in persistence, restore it.
- Otherwise create a new empty session.
- Empty session title may be a placeholder until the first user message arrives.

## Title Derivation

The title should be set from the first meaningful user message in the session.

Rules:

- Use the first user message that starts the task.
- Trim, normalize, and shorten for display.
- Once a session has a title, do not replace it automatically during normal conversation.

## Dirty State

The session should track whether it has changed since last save.

Recommended fields and behavior:

- `dirty = true` when any agent message list changes.
- `savedAt` updates when a saved snapshot is written.
- Optionally maintain a lightweight `lastPersistedAt` or content hash internally for future optimization, but the product behavior should be expressed as `dirty`.

## Save Behavior

## Manual Save

Clicking `SAVE` stores the current session as a single saved session entry.

Rules:

- Save all agent conversations contained in the current session.
- `savedAt` is the timestamp of the latest message across all agents.
- `lastActiveAgentId` stores the agent being viewed at save time.
- The saved entry appears as one record in the sessions panel.

The sessions panel should show:

- Session title
- Last message timestamp formatted as `YYYY/M/D HH:mm`

## Save Semantics

Manual save should create a saved session record without depending on which agent is currently selected.

This means:

- No partial save by current agent only
- No separate saved records per agent for the same task
- One saved record equals one multi-agent conversation snapshot

## Restore Behavior

## Pre-Restore Auto-Save

When the user clicks a saved session to restore it, the app should first evaluate whether the current runtime session needs protection.

Auto-save the current runtime session only if both conditions are true:

- The current session is non-empty
- The current session has unsaved changes (`dirty === true`)

If those conditions are met:

- Save the current runtime session as a new saved session entry
- Do not overwrite existing entries
- Use a new `session.id`

This ensures the user's in-progress work is not lost when restoring another session.

## Restore Target Session

After the optional pre-restore auto-save:

- Replace the current runtime session with the selected saved session
- Set `currentSessionId` to the restored session id or a runtime clone id, depending on implementation choice
- Restore `lastActiveAgentId` if still valid
- Re-render the current visible agent chat

After restore:

- Clicking different agents shows their messages inside the restored session
- The restored session becomes the active runtime context

## New Chat Behavior

`NEW CHAT` should create a new empty session, not a new chat for only one agent.

Rules:

- If the current session is non-empty and dirty, it may be auto-saved before creating the new session
- The new session starts with empty agent message collections
- The current visible agent remains selected if it still exists

## Persistence Model

## Primary Persistence

Runtime persistence should be session-based rather than agent-based.

Recommended persisted structures:

- `matrix_current_session_v1` or equivalent for active runtime session
- `matrix_sessions_v3` or equivalent for saved session list

The exact key names may vary, but the separation should be:

- one active runtime session
- a list of saved session snapshots

## Agent Message Access

All existing code paths that currently read or write messages through agent-specific chat storage should be redirected to session-backed accessors.

Examples of required accessor behavior:

- `getAgentMessages(agentId)` returns `currentSession.agents[agentId].messages`
- `setAgentMessages(agentId, msgs)` updates the current session and marks it dirty
- any append operation ensures the agent node exists inside the current session

## Migration And Compatibility

## Runtime Chat Migration

During upgrade, old runtime agent chats should be migrated into one runtime session.

Rules:

- Read existing per-agent runtime chat sources
- Create one current session
- Populate `session.agents[agentId].messages` for each agent with existing content
- Mark the migrated session appropriately so the user can continue without losing prior chats

## Saved Session Compatibility

Older saved sessions that contain only one agent should remain loadable.

Compatibility rule:

- When reading an old saved record, wrap it into the new session format
- Put its message list under `session.agents[legacyAgentId]`
- Populate title and timestamps from the legacy record

This avoids breaking old saved data and allows gradual migration.

## UI Behavior

## Sessions Panel

Each visible entry represents one whole session, not one agent chat.

Each row should display:

- title
- formatted last activity time based on the last message in the session

Optional metadata such as agent count may be added later, but it is not required for the first implementation.

## Agent List

The left agent list continues to show available agents globally.

Within a restored session:

- Agents with messages show their history when selected
- Agents without messages show an empty chat view

If a saved session references an agent that no longer exists:

- Preserve the data in the session payload
- Do not render the deleted agent in the active list unless a later product decision explicitly supports archived agents

## Edge Cases

- Empty current session: do not auto-save before restore
- Current session saved already and unchanged: do not auto-save duplicate snapshot
- Newly added agent with no messages in an older session: render empty chat
- Deleted agent referenced by an older session: preserve session data but skip normal rendering
- Background agent responses must still update the current session even when the user is viewing another agent

## Testing Focus

Manual or automated verification should cover:

- Saving a multi-agent task produces one saved session entry
- Restoring that session shows the correct messages for each agent when switching agents
- Loading an old saved session auto-saves the current dirty non-empty session first
- Repeated restore without changes does not create duplicate auto-saves
- Old single-agent saved sessions still load successfully
- New messages after restore are written into the restored active session

## Implementation Notes

The lowest-risk implementation path is:

1. Introduce session data structures and accessor helpers
2. Redirect runtime message reads and writes to the current session
3. Replace `SAVE` and restore logic in `session.js`
4. Add compatibility adapters for legacy saved sessions
5. Add one-time migration from per-agent runtime chat storage
6. Remove or demote old agent-chat persistence paths once verified

## Open Decisions Resolved

The following product decisions are considered fixed for implementation:

- One saved session represents the entire multi-agent task conversation
- Runtime chat storage becomes session-centric
- Loading a saved session first auto-saves the current session only if it is non-empty and dirty
- Auto-save before restore creates a new saved session entry and does not overwrite old records
- Session title comes from the first user message
- Session time shown in the UI comes from the last message time, formatted to minute precision
