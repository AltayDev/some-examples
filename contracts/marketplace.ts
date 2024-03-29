/**
 * AltaiLabs
 * Marketplace
 * Version: 0.8.0
 * */
import {
  Args,
  byteToBool,
  bytesToString,
  bytesToU64,
  stringToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  Address,
  Context,
  Storage,
  call,
  generateEvent,
  sendMessage,
  transferCoins,
  createSC,
} from '@massalabs/massa-as-sdk';
import {
  SellOffer,
  CollectionDetail,
  ItemDetail,
} from '../utilities/marketplace-complex';

export const ownerKey = 'MARKETPLACE_OWNER';
export const sellOfferKey = 'sellOffer_';
export const buyOfferKey = 'buyOffer_';
export const userCollectionsKey = 'collection_';
export const itemCollectionKey = 'item_';
export const NFT_CONTRACT_CODE_KEY: StaticArray<u8> = [0x01];
export const CREATE_NFT_PRICE_KEY: StaticArray<u8> = [0x02];

//for asc
export const genesisTimestamp = 1704289800000; //buildnet
export const t0 = 16000;
export const thread_count = 32;

/**
 * This function is meant to be called only one time: when the contract is deployed.
 *
 * @param args - The arguments to the constructor containing the message to be logged
 */

export function constructor(binaryArgs: StaticArray<u8>): void {
  // This line is important. It ensures that this function can't be called in the future.
  // If you remove this check, someone could call your constructor function and reset your smart contract.
  if (!Context.isDeployingContract()) {
    return;
  }
  const args = new Args(binaryArgs);
  const marketplaceOwner = args
    .nextString()
    .expect('marketplaceOwner argument is missing or invalid');
  const createNftPrice = args
    .nextU64()
    .expect('nftprice argument is missing or invalid');
  const contract_code = args
    .nextUint8Array()
    .expect('contract_code argument is missing or invalid');

  const staticArrayCode: StaticArray<u8> =
    changetype<StaticArray<u8>>(contract_code);

  Storage.set(NFT_CONTRACT_CODE_KEY, staticArrayCode);
  Storage.set(ownerKey, marketplaceOwner);
  Storage.set(CREATE_NFT_PRICE_KEY, u64ToBytes(createNftPrice));
  generateEvent('Purrfect Marketplace is deployed...');
}

/**
 * @returns true if the caller is the creator of the SC
 */
function _onlyOwner(): bool {
  return Context.caller().toString() == Storage.get(ownerKey);
}

/**
 * @returns true if at least one of the collections is available
 */
function _weHaveCollection(collectionAddress: string): bool {
  const key = userCollectionsKey + collectionAddress;
  const keyItem = itemCollectionKey + collectionAddress;

  // Check if at least one of the collections exists
  return Storage.has(key) || Storage.has(keyItem);
}

/**
 * @returns Remove Sell offer autonomously when it expires
 */
export function autonomousDelOffer(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const collectionAddress = args.nextString().expect('');
  const tokenID = args.nextU64().expect('');

  const caller = Context.caller().toString();
  assert(caller == Context.callee().toString(), 'you are not the SC');

  const key = sellOfferKey + collectionAddress + '_' + tokenID.toString();
  const check = Storage.has(key);
  assert(check, 'sell offer not found');

  Storage.del(stringToBytes(key));
}

export function adminAddCollection(binaryArgs: StaticArray<u8>): void {
  assert(_onlyOwner(), 'The caller is not the owner of the contract');
  const args = new Args(binaryArgs);
  const collectionName = args.nextString().expect('');
  const collectionDesc = args.nextString().expect('');
  const collectionAddress = args.nextString().expect('');
  const collectionWebsite = args.nextString().expect('');
  const bannerImage = args.nextString().expect('');
  const collectionBackgroundImage = args.nextString().expect('');
  const collectionLogoImage = args.nextString().expect('');

  const key = userCollectionsKey + collectionAddress;
  const collection = new CollectionDetail(
    collectionName,
    collectionDesc,
    collectionAddress,
    collectionWebsite,
    bannerImage,
    collectionBackgroundImage,
    collectionLogoImage,
  );
  Storage.set(stringToBytes(key), collection.serialize());
}

export function adminDellCollection(binaryArgs: StaticArray<u8>): void {
  assert(_onlyOwner(), 'The caller is not the owner of the contract');
  const args = new Args(binaryArgs);
  const collectionSCAddress = args.nextString().expect('');
  const key = userCollectionsKey + collectionSCAddress;
  Storage.del(stringToBytes(key));
}

export function adminChangeMarketplaceOwner(binaryArgs: StaticArray<u8>): void {
  assert(_onlyOwner(), 'The caller is not the owner of the contract');
  const args = new Args(binaryArgs);
  const newAdmin = args.nextString().unwrap();
  Storage.set(ownerKey, newAdmin);
}

export function adminSendCoins(binaryArgs: StaticArray<u8>): void {
  assert(_onlyOwner(), 'The caller is not the owner of the contract');
  const args = new Args(binaryArgs);
  const address = args.nextString().unwrap();
  const amount = args.nextU64().unwrap();

  transferCoins(new Address(address), amount);
}

export function adminDeleteOffer(binaryArgs: StaticArray<u8>): void {
  assert(_onlyOwner(), 'The caller is not the owner of the contract');
  const args = new Args(binaryArgs);
  const collectionAddress = args.nextString().unwrap();
  const nftTokenId = args.nextU64().unwrap();
  const key = sellOfferKey + collectionAddress + '_' + nftTokenId.toString();
  Storage.del(stringToBytes(key));
}

export function adminChangeNFTPrice(binaryArgs: StaticArray<u8>): void {
  assert(_onlyOwner(), 'The caller is not the owner of the contract');
  const args = new Args(binaryArgs);
  const newPrice = args.nextU64().unwrap();
  Storage.set(CREATE_NFT_PRICE_KEY, u64ToBytes(newPrice));
}
/**
 * @returns sell offer in marketplace
 */
export function sellOffer(binaryArgs: StaticArray<u8>): void {
  //args
  const args = new Args(binaryArgs);
  const collectionAddress = args.nextString().unwrap();
  const nftTokenId = args.nextU256().unwrap();
  const price = args.nextU64().unwrap();
  const expireIn = args.nextU64().unwrap();

  //date
  const expirationTime = Context.timestamp() + expireIn;
  const creatorAddress = Context.caller().toString();
  const createdTime = Context.timestamp();

  assert(
    _weHaveCollection(collectionAddress),
    'Collection not found in marketplace',
  );
  const key = sellOfferKey + collectionAddress + '_' + nftTokenId.toString();
  assert(!Storage.has(key), 'Sell offer already exist');

  const owner = bytesToString(
    call(
      new Address(collectionAddress),
      'ownerOf',
      new Args().add(nftTokenId),
      0,
    ),
  );
  assert(
    owner == creatorAddress,
    'You are not the owner of NFT owner:' +
      owner.toString() +
      ' callerAddress: ' +
      creatorAddress.toString(),
  );

  const approved = byteToBool(
    call(
      new Address(collectionAddress),
      'isApprovedForAll',
      new Args().add(creatorAddress).add(Context.callee().toString()),
      0,
    ),
  );
  assert(approved, 'Marketplace not approved for trading');

  const newSellOffer = new SellOffer(
    collectionAddress,
    nftTokenId.toString(),
    price,
    creatorAddress,
    expirationTime,
    createdTime,
  );

  Storage.set(stringToBytes(key), newSellOffer.serialize());

  //send ASC Message for delete when time is up
  const startPeriod = floor((expirationTime - genesisTimestamp) / t0);
  const startThread = floor(
    (expirationTime - genesisTimestamp - startPeriod * t0) /
      (t0 / thread_count),
  ) as u8;
  const endPeriod = startPeriod + 10;
  const endThread = 31 as u8;

  const maxGas = 500_000_000; // gas for smart contract execution
  const rawFee = 0;
  const coins = 0;

  const scaddr = Context.callee();
  sendMessage(
    scaddr,
    'autonomousDelOffer',
    startPeriod,
    startThread,
    endPeriod,
    endThread,
    maxGas,
    rawFee,
    coins,
    new Args().add(collectionAddress).add(nftTokenId).serialize(),
  );
}

/**
 * @returns remove sell offer in marketplace
 */
export function removeSellOffer(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const collectionAddress = args.nextString().unwrap();
  const nftTokenId = args.nextU256().unwrap();
  assert(
    _weHaveCollection(collectionAddress),
    'Collection not found in marketplace',
  );
  const key = sellOfferKey + collectionAddress + '_' + nftTokenId.toString();
  assert(Storage.has(key), 'Sell offer doesnt exist');

  const storedData = Storage.get(stringToBytes(key));
  const offset: i32 = 0;
  const sellOfferData = new SellOffer('', '', 0, '', 0, 0);
  const deserializeResult = sellOfferData.deserialize(storedData, offset);

  assert(deserializeResult.isOk(), 'DESERIALIZATION_ERROR');

  assert(
    sellOfferData.creatorAddress == Context.caller().toString(),
    'Only the creator can remove the sell offer',
  );
  let owner = bytesToString(
    call(
      new Address(collectionAddress),
      'ownerOf',
      new Args().add(nftTokenId),
      0,
    ),
  );
  assert(owner == Context.caller().toString(), 'You are not the owner of NFT');
  Storage.del(stringToBytes(key));
  generateEvent('REMOVE_SELL_OFFER : ' + Context.caller().toString());
}

/**
 * @returns buy offer in marketplace
 */
export function buyOffer(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const collectionAddress = args.nextString().unwrap();
  const nftTokenId = args.nextU256().unwrap();

  assert(
    _weHaveCollection(collectionAddress),
    'Collection not found in marketplace',
  );
  const key = sellOfferKey + collectionAddress + '_' + nftTokenId.toString();
  assert(Storage.has(key), 'Sell offer doesnt exist');

  const storedData = Storage.get(stringToBytes(key));
  const offset: i32 = 0;
  const sellOfferData = new SellOffer('', '', 0, '', 0, 0);
  const deserializeResult = sellOfferData.deserialize(storedData, offset);

  assert(deserializeResult.isOk(), 'DESERIALIZATION_ERROR');

  const expirationTime = sellOfferData.expirationTime;

  assert(Context.timestamp() <= expirationTime, 'Sell offer has expired');
  assert(
    Context.transferredCoins() >= sellOfferData.price,
    'Could not send enough money or marketplace fees to buy this NFT',
  );
  let owner = bytesToString(
    call(
      new Address(collectionAddress),
      'ownerOf',
      new Args().add(nftTokenId),
      0,
    ),
  );
  const address = Context.caller().toString();

  call(
    new Address(collectionAddress),
    'transferFrom',
    new Args().add(owner).add(address).add(nftTokenId),
    1000000, //change this fee later
  );
  const pricePercentage = (sellOfferData.price / 100) * 3;
  const remainingCoins = sellOfferData.price - pricePercentage;

  transferCoins(new Address(owner), remainingCoins);
  generateEvent(
    `${Context.caller().toString()} bought this ${nftTokenId.toString()} NFT at this ${sellOfferData.price.toString()} price`,
  );

  //Delete sell offer key
  Storage.del(stringToBytes(key));
}

/**
 * @returns Create brand new NFT
 */
export function createNFT(binaryArgs: StaticArray<u8>): void {
  const price = bytesToU64(Storage.get(CREATE_NFT_PRICE_KEY));
  const amount_check = Context.transferredCoins();
  assert(amount_check >= price, 'Insufficient balance for create NFT.');

  const args = new Args(binaryArgs);
  const name = args.nextString().expect('we need the name...');
  const symbol = args.nextString().expect('we need the symbol...');
  const baseURI = args.nextString().expect('we need the baseURI...');

  let nft_contract_code = Storage.get(NFT_CONTRACT_CODE_KEY);
  let addr = createSC(nft_contract_code);
  call(
    addr,
    'constructor',
    new Args()
      .add(name)
      .add(symbol)
      .add(baseURI)
      .add(Context.caller().toString()), // delegated owner
    11000000,
  );
  const newItem = new ItemDetail(name, symbol, addr.toString(), baseURI);
  Storage.set(
    stringToBytes(itemCollectionKey + addr.toString()),
    newItem.serialize(),
  );
}
