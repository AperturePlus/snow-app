export type CheckpointFileChange = {
  path: string;
  changeType: string;
};

export type CheckpointFileDiff = CheckpointFileChange & {
  content: string;
  isBinary: boolean;
};
