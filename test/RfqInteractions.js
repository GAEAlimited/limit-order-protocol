const { expect } = require('@1inch/solidity-utils');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { deploySwapTokens } = require('./helpers/fixtures');
const { ethers } = require('hardhat');
const { ether } = require('./helpers/utils');
const { buildOrderRFQ, signOrder, buildMakerTraits, buildTakerTraits } = require('./helpers/orderUtils');

describe('RfqInteractions', function () {
    let addr, addr1;
    const abiCoder = ethers.utils.defaultAbiCoder;

    before(async function () {
        [addr, addr1] = await ethers.getSigners();
    });

    async function initContracts () {
        const { dai, weth, swap, chainId } = await deploySwapTokens();

        await dai.mint(addr.address, ether('100'));
        await dai.mint(addr1.address, ether('100'));
        await weth.deposit({ value: ether('1') });
        await weth.connect(addr1).deposit({ value: ether('1') });

        await dai.approve(swap.address, ether('100'));
        await dai.connect(addr1).approve(swap.address, ether('100'));
        await weth.approve(swap.address, ether('1'));
        await weth.connect(addr1).approve(swap.address, ether('1'));

        const RecursiveMatcher = await ethers.getContractFactory('RecursiveMatcher');
        const matcher = await RecursiveMatcher.deploy();
        await matcher.deployed();

        return { dai, weth, swap, chainId, matcher };
    };

    describe('recursive swap rfq orders', function () {
        it('opposite direction recursive swap', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContracts);

            const order = buildOrderRFQ({
                maker: addr.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
            });
            const backOrder = buildOrderRFQ({
                maker: addr1.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.1'),
                takingAmount: ether('100'),
            });
            const signature = await signOrder(order, chainId, swap.address, addr);
            const signatureBackOrder = await signOrder(backOrder, chainId, swap.address, addr1);

            const matchingParams = matcher.address + '01' + abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [
                        weth.address,
                        dai.address,
                    ],
                    [
                        weth.interface.encodeFunctionData('approve', [swap.address, ether('0.1')]),
                        dai.interface.encodeFunctionData('approve', [swap.address, ether('100')]),
                    ],
                ],
            ).substring(2);

            const { r: backOrderR, _vs: backOrderVs } = ethers.utils.splitSignature(signatureBackOrder);
            const takerTraits = buildTakerTraits({
                minReturn: ether('0.1'),
                interaction: matchingParams,
            });
            const interaction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                backOrder,
                backOrderR,
                backOrderVs,
                ether('100'),
                takerTraits.traits,
                takerTraits.args,
            ]).substring(10);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const matcherTraits = buildTakerTraits({
                minReturn: ether('100'),
                interaction,
            });
            await matcher.matchOrders(swap.address, order, r, vs, ether('0.1'), matcherTraits.traits, matcherTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.add(ether('0.1')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.sub(ether('0.1')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.sub(ether('100')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.add(ether('100')));
        });

        it('unidirectional recursive swap', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContracts);

            const order = buildOrderRFQ({
                maker: addr1.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                makerTraits: buildMakerTraits({ nonce: 1 }),
            });
            const backOrder = buildOrderRFQ({
                maker: addr1.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('15'),
                takingAmount: ether('0.015'),
                makerTraits: buildMakerTraits({ nonce: 2 }),
            });
            const signature = await signOrder(order, chainId, swap.address, addr1);
            const signatureBackOrder = await signOrder(backOrder, chainId, swap.address, addr1);

            const matchingParams = matcher.address + '01' + abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [
                        weth.address,
                        weth.address,
                        dai.address,
                    ],
                    [
                        weth.interface.encodeFunctionData('transferFrom', [addr.address, matcher.address, ether('0.025')]),
                        dai.interface.encodeFunctionData('approve', [swap.address, ether('0.025')]),
                        weth.interface.encodeFunctionData('transfer', [addr.address, ether('25')]),
                    ],
                ],
            ).substring(2);

            const { r: backOrderR, _vs: backOrderVs } = ethers.utils.splitSignature(signatureBackOrder);
            const takerTraits = buildTakerTraits({
                minReturn: ether('15'),
                interaction: matchingParams,
            });
            const interaction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                backOrder,
                backOrderR,
                backOrderVs,
                ether('0.015'),
                takerTraits.traits,
                takerTraits.args,
            ]).substring(10);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            await weth.approve(matcher.address, ether('0.025'));
            const { r, _vs: vs } = ethers.utils.splitSignature(signature);
            const matcherTraits = buildTakerTraits({
                minReturn: ether('10'),
                interaction,
            });
            await matcher.matchOrders(swap.address, order, r, vs, ether('0.01'), matcherTraits.traits, matcherTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.sub(ether('0.025')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.add(ether('0.025')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.add(ether('25')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.sub(ether('25')));
        });

        it('triple recursive swap', async function () {
            const { dai, weth, swap, chainId, matcher } = await loadFixture(initContracts);

            const order1 = buildOrderRFQ({
                maker: addr1.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                makerTraits: buildMakerTraits({ nonce: 1 }),
            });
            const order2 = buildOrderRFQ({
                maker: addr1.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('15'),
                takingAmount: ether('0.015'),
                makerTraits: buildMakerTraits({ nonce: 2 }),
            });
            const backOrder = buildOrderRFQ({
                maker: addr.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.025'),
                takingAmount: ether('25'),
                makerTraits: buildMakerTraits({ nonce: 1 }),
            });

            const signature1 = await signOrder(order1, chainId, swap.address, addr1);
            const signature2 = await signOrder(order2, chainId, swap.address, addr1);
            const signatureBackOrder = await signOrder(backOrder, chainId, swap.address, addr);

            const matchingParams = matcher.address + '01' + abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [
                        weth.address,
                        dai.address,
                    ],
                    [
                        weth.interface.encodeFunctionData('approve', [swap.address, ether('0.025')]),
                        dai.interface.encodeFunctionData('approve', [swap.address, ether('25')]),
                    ],
                ],
            ).substring(2);

            const { r: backOrderR, _vs: backOrderVs } = ethers.utils.splitSignature(signatureBackOrder);
            const internalTakerTraits = buildTakerTraits({
                minReturn: ether('0.025'),
                interaction: matchingParams,
            });
            const internalInteraction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                backOrder,
                backOrderR,
                backOrderVs,
                ether('25'),
                internalTakerTraits.traits,
                internalTakerTraits.args,
            ]).substring(10);

            const { r: order2R, _vs: order2Vs } = ethers.utils.splitSignature(signature2);
            const externalTakerTraits = buildTakerTraits({
                minReturn: ether('15'),
                interaction: internalInteraction,
            });
            const externalInteraction = matcher.address + '00' + swap.interface.encodeFunctionData('fillOrderArgs', [
                order2,
                order2R,
                order2Vs,
                ether('0.015'),
                externalTakerTraits.traits,
                externalTakerTraits.args,
            ]).substring(10);

            const addrweth = await weth.balanceOf(addr.address);
            const addr1weth = await weth.balanceOf(addr1.address);
            const addrdai = await dai.balanceOf(addr.address);
            const addr1dai = await dai.balanceOf(addr1.address);

            const { r, _vs: vs } = ethers.utils.splitSignature(signature1);
            const matcherTraits = buildTakerTraits({
                minReturn: ether('10'),
                interaction: externalInteraction,
            });
            await matcher.matchOrders(swap.address, order1, r, vs, ether('0.01'), matcherTraits.traits, matcherTraits.args);

            expect(await weth.balanceOf(addr.address)).to.equal(addrweth.sub(ether('0.025')));
            expect(await weth.balanceOf(addr1.address)).to.equal(addr1weth.add(ether('0.025')));
            expect(await dai.balanceOf(addr.address)).to.equal(addrdai.add(ether('25')));
            expect(await dai.balanceOf(addr1.address)).to.equal(addr1dai.sub(ether('25')));
        });
    });
});
