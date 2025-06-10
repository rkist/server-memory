# Knowledge Graph Memory Server

A basic implementation of persistent memory using a local knowledge graph on a per-project basis.

## Core Concepts

### Entities
Entities are the primary nodes in the knowledge graph. Each entity has:
- A unique name (identifier)
- An entity type (e.g., "person", "organization", "event")
- A list of observations

Example:
```json
{
  "name": "David Barnett",
  "entityType": "person",
  "observations": ["Speaks fluent Spanish"]
}
```

### Relations
Relations define directed connections between entities. They are always stored in active voice and describe how entities interact or relate to each other.

Example:
```json
{
  "from": "David Barnett",
  "to": "QuintoAndar",
  "relationType": "works_at"
}
```
### Observations
Observations are discrete pieces of information about an entity. They are:

- Stored as strings
- Attached to specific entities
- Can be added or removed independently
- Should be atomic (one fact per observation)

Example:
```json
{
  "entityName": "David Barnett",
  "observations": [
    "Speaks fluent Spanish",
    "Prefers morning meetings"
  ]
}
```

## API

### Tools

**All tools now require a `projectIdentifier` argument (string) as the first part of their input. This identifier (e.g., the project's name or a unique ID like its path) is used to create/access a dedicated memory store for that project. By default, project memories are stored in subdirectories under `~/.mcp_server_memory_by_project/`. This base path can be changed by setting the `MCP_BASE_MEMORY_DIR` environment variable.**

- **create_entities**
  - Create multiple new entities in the knowledge graph for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `entities` (array of objects)
    - Each object contains:
      - `name` (string): Entity identifier
      - `entityType` (string): Type classification
      - `observations` (string[]): Associated observations
  - Ignores entities with existing names

- **create_relations**
  - Create multiple new relations between entities for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `relations` (array of objects)
    - Each object contains:
      - `from` (string): Source entity name
      - `to` (string): Target entity name
      - `relationType` (string): Relationship type in active voice
  - Skips duplicate relations

- **add_observations**
  - Add new observations to existing entities for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `observations` (array of objects)
    - Each object contains:
      - `entityName` (string): Target entity
      - `contents` (string[]): New observations to add
  - Returns added observations per entity
  - Fails if entity doesn't exist

- **delete_entities**
  - Remove entities and their relations for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `entityNames` (string[])
  - Cascading deletion of associated relations
  - Silent operation if entity doesn't exist

- **delete_observations**
  - Remove specific observations from entities for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `deletions` (array of objects)
    - Each object contains:
      - `entityName` (string): Target entity
      - `observations` (string[]): Observations to remove
  - Silent operation if observation doesn't exist

- **delete_relations**
  - Remove specific relations from the graph for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `relations` (array of objects)
    - Each object contains:
      - `from` (string): Source entity name
      - `to` (string): Target entity name
      - `relationType` (string): Relationship type
  - Silent operation if relation doesn't exist

- **read_graph**
  - Read the entire knowledge graph for the specified project.
  - Input: 
    - `projectIdentifier` (string)
  - No input required
  - Returns complete graph structure with all entities and relations

- **search_nodes**
  - Search for nodes based on query for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `query` (string)
  - Searches across:
    - Entity names
    - Entity types
    - Observation content
  - Returns matching entities and their relations

- **open_nodes**
  - Retrieve specific nodes by name for the specified project.
  - Input: 
    - `projectIdentifier` (string)
    - `names` (string[])
  - Returns:
    - Requested entities
    - Relations between requested entities
  - Silently skips non-existent nodes

# Usage with Claude Desktop

### Setup

Add this to your claude_desktop_config.json:

#### Docker

```json
{
  "mcpServers": {
    "memory": {
      "command": "docker",
      "args": [
        "run", "-i", 
        // Mount a host directory to persist memories. 
        // Inside the container, os.homedir() (~) is /root for the default user.
        // The server stores memories in BASE_MEMORY_DIR/projectIdentifier/memory.jsonl
        // Default BASE_MEMORY_DIR is ~/.mcp_server_memory_by_project/
        "-v", "/path/on/your/host/project_memories:/root/.mcp_server_memory_by_project", 
        "--rm", 
        "mcp/memory" 
      ]
      // Optionally, set MCP_BASE_MEMORY_DIR in the container:
      // "env": {
      //   "MCP_BASE_MEMORY_DIR": "/app/custom_memory_location"
      //   // If you use this, ensure your volume mount (-v) targets this custom location.
      // }
    }
  }
}
```

#### NPX with custom setting

The server can be configured using the following environment variables:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "-y",
        "@rkist/server-memory"
      ],
      "env": {
        // MCP_BASE_MEMORY_DIR: Path to the base directory for storing all project-specific memories.
        // Default is ~/.mcp_server_memory_by_project/
        "MCP_BASE_MEMORY_DIR": "/path/to/custom/base_memory_dir"
      }
    }
  }
}
```

- `MCP_BASE_MEMORY_DIR`: Overrides the default base directory (`~/.mcp_server_memory_by_project/`) for storing project memories.

# VS Code Installation Instructions


```json
{
  "mcp": {
    "servers": {
      "memory": {
        "command": "docker",
        "args": [
          "run",
          "-i",
          // Ensure consistent volume mount for data persistence
          "-v",
          "/path/on/your/host/project_memories_vscode:/root/.mcp_server_memory_by_project",
          "--rm",
          "mcp/memory"
        ]
      }
    }
  }
}
```

### System Prompt
Check [Memory Rule Example](memory.mdc)

## Building

Docker:

```sh
docker build -t mcp/memory . 
```
