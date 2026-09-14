// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title CoinDraft Achievements
/// @notice Soulbound (non-transferable) ERC-721 badges for CoinDraft, claimed
/// by the player themselves — not pushed to their wallet by the backend.
///
/// Flexible by design for two different audiences:
///  - The contract owner can define new achievement TYPES at any time
///    (name, description, metadata URI) without redeploying — the badge
///    catalog grows as the game grows.
///  - The CoinDraft backend decides off-chain when a player has EARNED a
///    type (first win against a real opponent, first win against a bot, a
///    correct quiz answer, a 5-answer quiz streak) and hands them a signed
///    voucher for it. The player then calls `claimAchievement` themselves,
///    from their own wallet, paying their own gas — so the mint is
///    genuinely their action, not something that just appeared. The
///    contract never trusts the backend's word directly; it verifies the
///    signature on-chain before minting anything.
///
/// Badges are non-transferable once claimed: they represent something a
/// specific player actually did, not an asset to trade. Every
/// transfer/approval path is blocked; only the initial claim-mint is allowed.
contract CoinDraftAchievements is ERC721, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct AchievementType {
        string name;
        string description;
        string metadataURI;
        bool active;
    }

    /// @notice All achievement types ever defined, indexed by typeId.
    mapping(uint256 => AchievementType) public achievementTypes;
    uint256 public nextTypeId;

    /// @notice Addresses whose signature the contract accepts as proof a
    /// claim voucher is genuine. Meant for the CoinDraft backend's own
    /// server wallet — it never sends a transaction itself, only signs.
    mapping(address => bool) public signers;

    /// @notice Whether `user` already holds `typeId` — claims are one-shot.
    mapping(address => mapping(uint256 => bool)) public hasAchievement;

    mapping(address => mapping(uint256 => uint256)) private _tokenIdByTypeForUser;
    mapping(address => uint256[]) private _userTypes;

    uint256 private _nextTokenId = 1;

    event AchievementTypeAdded(uint256 indexed typeId, string name, string metadataURI);
    event AchievementTypeUpdated(uint256 indexed typeId, string name, string metadataURI, bool active);
    event SignerUpdated(address indexed signer, bool allowed);
    event AchievementClaimed(address indexed player, uint256 indexed typeId, uint256 indexed tokenId);

    constructor() ERC721("CoinDraft Achievements", "CDACH") Ownable(msg.sender) {}

    // ── Admin: achievement type registry ────────────────────────────────

    /// @notice Defines a new achievement type. Callable any time, no redeploy needed.
    function addAchievementType(
        string calldata name,
        string calldata description,
        string calldata metadataURI
    ) external onlyOwner returns (uint256 typeId) {
        typeId = nextTypeId++;
        achievementTypes[typeId] = AchievementType(name, description, metadataURI, true);
        emit AchievementTypeAdded(typeId, name, metadataURI);
    }

    /// @notice Edits an existing type's copy/metadata, or retires it (active = false).
    /// Retiring a type stops new claims of it; badges already minted are unaffected.
    function updateAchievementType(
        uint256 typeId,
        string calldata name,
        string calldata description,
        string calldata metadataURI,
        bool active
    ) external onlyOwner {
        require(typeId < nextTypeId, "CoinDraftAchievements: unknown achievement type");
        achievementTypes[typeId] = AchievementType(name, description, metadataURI, active);
        emit AchievementTypeUpdated(typeId, name, metadataURI, active);
    }

    function setSigner(address signer, bool allowed) external onlyOwner {
        signers[signer] = allowed;
        emit SignerUpdated(signer, allowed);
    }

    // ── Claiming ─────────────────────────────────────────────────────────

    /// @notice Claims `typeId` for the caller, using a voucher signed by an
    /// authorized backend signer. The signed message is scoped to this exact
    /// contract, this exact player, and this exact achievement type, so a
    /// voucher can't be replayed on another contract, claimed by a different
    /// address, or reused for a different achievement.
    function claimAchievement(uint256 typeId, bytes calldata signature) external returns (uint256 tokenId) {
        require(typeId < nextTypeId, "CoinDraftAchievements: unknown achievement type");
        require(achievementTypes[typeId].active, "CoinDraftAchievements: achievement type retired");
        require(!hasAchievement[msg.sender][typeId], "CoinDraftAchievements: already claimed");

        bytes32 voucher = keccak256(abi.encodePacked(address(this), msg.sender, typeId));
        address signer = voucher.toEthSignedMessageHash().recover(signature);
        require(signers[signer], "CoinDraftAchievements: invalid or unauthorized voucher");

        tokenId = _nextTokenId++;
        hasAchievement[msg.sender][typeId] = true;
        _tokenIdByTypeForUser[msg.sender][typeId] = tokenId;
        _userTypes[msg.sender].push(typeId);

        _safeMint(msg.sender, tokenId);
        emit AchievementClaimed(msg.sender, typeId, tokenId);
    }

    // ── Reads ────────────────────────────────────────────────────────────

    function userAchievementTypes(address user) external view returns (uint256[] memory) {
        return _userTypes[user];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address holder = _requireOwned(tokenId);
        // Reverse-lookup by scanning the holder's own (small) achievement
        // list — a handful of badges per player, not thousands, so this
        // stays cheap without a second storage mapping just for this.
        uint256[] memory types = _userTypes[holder];
        for (uint256 i = 0; i < types.length; i++) {
            if (_tokenIdByTypeForUser[holder][types[i]] == tokenId) {
                return achievementTypes[types[i]].metadataURI;
            }
        }
        return "";
    }

    // ── Soulbound: every path except the initial claim-mint is blocked ──

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        require(_ownerOf(tokenId) == address(0), "CoinDraftAchievements: soulbound, non-transferable");
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert("CoinDraftAchievements: soulbound, non-transferable");
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("CoinDraftAchievements: soulbound, non-transferable");
    }
}
