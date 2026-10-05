import { mintChallengeResponse } from '@nota/native';

export const getChallengeResponse = async (resource: string) => {
  return mintChallengeResponse(resource, 20);
};
