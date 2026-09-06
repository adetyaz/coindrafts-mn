// Minimal ABI — only what the app actually calls. Hand-authored to match
// contracts/contracts/CoinDraftAchievements.sol (the claim-based version) —
// keep these in sync if the contract changes.
export const ACHIEVEMENTS_ABI = [
	'function claimAchievement(uint256 typeId, bytes signature) external returns (uint256 tokenId)',
	'function hasAchievement(address user, uint256 typeId) external view returns (bool)',
	'function achievementTypes(uint256 typeId) external view returns (string name, string description, string metadataURI, bool active)',
	'function userAchievementTypes(address user) external view returns (uint256[] memory)',
	'event AchievementClaimed(address indexed player, uint256 indexed typeId, uint256 indexed tokenId)'
] as const;
