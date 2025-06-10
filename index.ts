#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Define base memory directory for project-specific storage
const defaultBaseMemoryDir = path.join(os.homedir(), '.mcp_server_memory');
const BASE_MEMORY_DIR = process.env.MCP_BASE_MEMORY_DIR
  ? path.isAbsolute(process.env.MCP_BASE_MEMORY_DIR)
    ? process.env.MCP_BASE_MEMORY_DIR
    : path.resolve(process.env.MCP_BASE_MEMORY_DIR)
  : defaultBaseMemoryDir;

// Helper function to get and ensure the project-specific memory file path
async function getProjectMemoryFilePath(projectIdentifier: string): Promise<string> {
  if (!projectIdentifier || projectIdentifier.trim() === "") {
    throw new Error("Project identifier cannot be empty and must be a valid string.");
  }
  // Basic sanitization for directory name. Consider more robust sanitization if needed.
  const saneProjectIdentifier = projectIdentifier.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (!saneProjectIdentifier || saneProjectIdentifier.startsWith('.')) {
    throw new Error(`Invalid project identifier after sanitization: ${projectIdentifier}`);
  }

  const projectMemoryDir = path.join(BASE_MEMORY_DIR, saneProjectIdentifier);
  try {
    await fs.mkdir(projectMemoryDir, { recursive: true }); // Ensure directory exists
  } catch (error) {
    console.error(`Failed to create directory ${projectMemoryDir}:`, error);
    throw new Error(`Failed to create project memory directory for ${saneProjectIdentifier}.`);
  }
  return path.join(projectMemoryDir, 'memory.jsonl'); // Using .jsonl extension
}

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private async loadGraph(projectIdentifier: string): Promise<KnowledgeGraph> {
    const filePath = await getProjectMemoryFilePath(projectIdentifier);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      return lines.reduce((graph: KnowledgeGraph, line) => {
        const item = JSON.parse(line);
        if (item.type === "entity") graph.entities.push(item as Entity);
        if (item.type === "relation") graph.relations.push(item as Relation);
        return graph;
      }, { entities: [], relations: [] });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  private async saveGraph(projectIdentifier: string, graph: KnowledgeGraph): Promise<void> {
    const filePath = await getProjectMemoryFilePath(projectIdentifier);
    const lines = [
      ...graph.entities.map(e => JSON.stringify({ type: "entity", ...e })),
      ...graph.relations.map(r => JSON.stringify({ type: "relation", ...r })),
    ];
    await fs.writeFile(filePath, lines.join("\n"));
  }

  async createEntities(projectIdentifier: string, entities: Entity[]): Promise<Entity[]> {
    const graph = await this.loadGraph(projectIdentifier);
    const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
    graph.entities.push(...newEntities);
    await this.saveGraph(projectIdentifier, graph);
    return newEntities;
  }

  async createRelations(projectIdentifier: string, relations: Relation[]): Promise<Relation[]> {
    const graph = await this.loadGraph(projectIdentifier);
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation => 
      existingRelation.from === r.from && 
      existingRelation.to === r.to && 
      existingRelation.relationType === r.relationType
    ));
    graph.relations.push(...newRelations);
    await this.saveGraph(projectIdentifier, graph);
    return newRelations;
  }

  async addObservations(projectIdentifier: string, observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph(projectIdentifier);
    const results = observations.map(o => {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObservations = o.contents.filter(content => !entity.observations.includes(content));
      entity.observations.push(...newObservations);
      return { entityName: o.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(projectIdentifier, graph);
    return results;
  }

  async deleteEntities(projectIdentifier: string, entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph(projectIdentifier);
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    await this.saveGraph(projectIdentifier, graph);
  }

  async deleteObservations(projectIdentifier: string, deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    const graph = await this.loadGraph(projectIdentifier);
    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
      }
    });
    await this.saveGraph(projectIdentifier, graph);
  }

  async deleteRelations(projectIdentifier: string, relations: Relation[]): Promise<void> {
    const graph = await this.loadGraph(projectIdentifier);
    graph.relations = graph.relations.filter(r => !relations.some(delRelation => 
      r.from === delRelation.from && 
      r.to === delRelation.to && 
      r.relationType === delRelation.relationType
    ));
    await this.saveGraph(projectIdentifier, graph);
  }

  async readGraph(projectIdentifier: string): Promise<KnowledgeGraph> {
    return this.loadGraph(projectIdentifier);
  }

  // Very basic search function
  async searchNodes(projectIdentifier: string, query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph(projectIdentifier);
    
    // Filter entities
    const filteredEntities = graph.entities.filter(e => 
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.entityType.toLowerCase().includes(query.toLowerCase()) ||
      e.observations.some(o => o.toLowerCase().includes(query.toLowerCase()))
    );
  
    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
  
    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
  
    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };
  
    return filteredGraph;
  }

  async openNodes(projectIdentifier: string, names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph(projectIdentifier);
    
    // Filter entities
    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
  
    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
  
    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r => 
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );
  
    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };
  
    return filteredGraph;
  }
}

const knowledgeGraphManager = new KnowledgeGraphManager();


// The server instance and tools exposed to Claude
const server = new Server({
  name: "memory-server",
  version: "0.6.3",
},    {
    capabilities: {
      tools: {},
    },
  },);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_entities",
        description: "Create multiple new entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The name of the entity" },
                  entityType: { type: "string", description: "The type of the entity" },
                  observations: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "An array of observation contents associated with the entity"
                  },
                },
                required: ["name", "entityType", "observations"],
              },
            },
          },
          required: ["projectIdentifier", "entities"],
        },
      },
      {
        name: "create_relations",
        description: "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
            },
          },
          required: ["projectIdentifier", "relations"],
        },
      },
      {
        name: "add_observations",
        description: "Add new observations to existing entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity to add the observations to" },
                  contents: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "An array of observation contents to add"
                  },
                },
                required: ["entityName", "contents"],
              },
            },
          },
          required: ["projectIdentifier", "observations"],
        },
      },
      {
        name: "delete_entities",
        description: "Delete multiple entities and their associated relations from the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            entityNames: { 
              type: "array", 
              items: { type: "string" },
              description: "An array of entity names to delete" 
            },
          },
          required: ["projectIdentifier", "entityNames"],
        },
      },
      {
        name: "delete_observations",
        description: "Delete specific observations from entities in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            deletions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity containing the observations" },
                  observations: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "An array of observations to delete"
                  },
                },
                required: ["entityName", "observations"],
              },
            },
          },
          required: ["projectIdentifier", "deletions"],
        },
      },
      {
        name: "delete_relations",
        description: "Delete multiple relations from the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            relations: { 
              type: "array", 
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
              description: "An array of relations to delete" 
            },
          },
          required: ["projectIdentifier", "relations"],
        },
      },
      {
        name: "read_graph",
        description: "Read the entire knowledge graph for a specific project",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
          },
          required: ["projectIdentifier"],
        },
      },
      {
        name: "search_nodes",
        description: "Search for nodes in the knowledge graph based on a query for a specific project",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            query: { type: "string", description: "The search query to match against entity names, types, and observation content" },
          },
          required: ["projectIdentifier", "query"],
        },
      },
      {
        name: "open_nodes",
        description: "Open specific nodes in the knowledge graph by their names for a specific project",
        inputSchema: {
          type: "object",
          properties: {
            projectIdentifier: { type: "string", description: "The name or unique ID of the project (e.g., 'my-web-app', 'api-service'). This will be used to create a dedicated memory store for the project." },
            names: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to retrieve",
            },
          },
          required: ["projectIdentifier", "names"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    case "create_entities":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createEntities(args.projectIdentifier as string, args.entities as Entity[]), null, 2) }] };
    case "create_relations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createRelations(args.projectIdentifier as string, args.relations as Relation[]), null, 2) }] };
    case "add_observations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.addObservations(args.projectIdentifier as string, args.observations as { entityName: string; contents: string[] }[]), null, 2) }] };
    case "delete_entities":
      await knowledgeGraphManager.deleteEntities(args.projectIdentifier as string, args.entityNames as string[]);
      return { content: [{ type: "text", text: "Entities deleted successfully" }] };
    case "delete_observations":
      await knowledgeGraphManager.deleteObservations(args.projectIdentifier as string, args.deletions as { entityName: string; observations: string[] }[]);
      return { content: [{ type: "text", text: "Observations deleted successfully" }] };
    case "delete_relations":
      await knowledgeGraphManager.deleteRelations(args.projectIdentifier as string, args.relations as Relation[]);
      return { content: [{ type: "text", text: "Relations deleted successfully" }] };
    case "read_graph":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.readGraph(args.projectIdentifier as string), null, 2) }] };
    case "search_nodes":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.searchNodes(args.projectIdentifier as string, args.query as string), null, 2) }] };
    case "open_nodes":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.openNodes(args.projectIdentifier as string, args.names as string[]), null, 2) }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
