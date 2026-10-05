import type { Server } from '@nota/core/modules/cloud';

// Enable-cloud component disabled — EE backend removed
export const CustomServerEnableCloud = ({
  serverList: _serverList,
  selectedServer: _selectedServer,
  setSelectedServer: _setSelectedServer,
  title: _title,
  description: _description,
}: {
  serverList: Server[];
  selectedServer: Server;
  title?: string;
  description?: string;
  setSelectedServer: (server: Server) => void;
}) => {
  return null;
};
