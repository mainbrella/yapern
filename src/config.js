import project from "../canopy.json" with { type: "json" };

// Public browser configuration copied from Canopy's message-board example.
export const messageBoardConfig = {
  apiOrigin: "https://api.mainbrella.com",
  projectId: project.projectId,
  publicKey:
    "bff_pk_1f9bb9fd543d6a5476ad7ce210577c2479d290a5cdc06282de9eb884d57005c4",
  table: "messages",
};
