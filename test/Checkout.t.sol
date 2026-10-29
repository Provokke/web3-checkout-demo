// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Checkout} from "../src/Checkout.sol";

/// Re-enters Checkout.refund from its receive hook.
contract ReentrantBuyer {
    Checkout public immutable checkout;
    bytes32 public target;
    uint256 public reenterTimes;
    uint256 public attempts;
    uint256 public blocked;

    constructor(Checkout c) {
        checkout = c;
    }

    function buy(bytes32 id, uint256 price, uint256 times) external {
        target = id;
        reenterTimes = times;
        checkout.pay{value: price}(id);
    }

    function startRefund() external {
        checkout.refund(target);
    }

    receive() external payable {
        for (uint256 i; i < reenterTimes; i++) {
            attempts++;
            try checkout.refund(target) {}
            catch {
                blocked++;
            }
        }
    }
}

contract CheckoutTest is Test {
    Checkout internal checkout;
    address internal merchant = makeAddr("merchant");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes32 internal constant ID = keccak256("order-1");
    uint256 internal constant PRICE = 1 ether;

    event Paid(bytes32 indexed orderId, address indexed payer, uint256 amount);

    function setUp() public {
        checkout = new Checkout(merchant);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.prank(merchant);
        checkout.createOrder(ID, PRICE);
    }

    // ---- the five named tests ----

    function test_RevertWhen_PayTwice() public {
        vm.prank(alice);
        checkout.pay{value: PRICE}(ID);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Checkout.WrongState.selector, ID, Checkout.State.Paid));
        checkout.pay{value: PRICE}(ID);
        assertEq(address(checkout).balance, PRICE);
    }

    function test_RevertWhen_NonMerchantReleases() public {
        vm.prank(alice);
        checkout.pay{value: PRICE}(ID);
        vm.prank(alice);
        vm.expectRevert(Checkout.NotMerchant.selector);
        checkout.release(ID);
        vm.prank(bob);
        vm.expectRevert(Checkout.NotMerchant.selector);
        checkout.release(ID);
    }

    function testFuzz_PayAmountsReleaseExact(uint96 price) public {
        price = uint96(bound(price, 1, 1_000 ether));
        bytes32 id = keccak256(abi.encode("fuzz", price));
        vm.deal(alice, uint256(price));
        vm.prank(merchant);
        checkout.createOrder(id, price);

        vm.expectEmit(true, true, false, true);
        emit Paid(id, alice, price);
        vm.prank(alice);
        checkout.pay{value: price}(id);

        vm.prank(merchant);
        checkout.release(id);
        assertEq(checkout.pending(merchant), price);

        uint256 before = merchant.balance;
        vm.prank(merchant);
        checkout.withdraw();
        assertEq(merchant.balance - before, price);
        assertEq(checkout.pending(merchant), 0);
    }

    function test_ReentrancyOnRefundBlocked() public {
        ReentrantBuyer atk = new ReentrantBuyer(checkout);
        vm.deal(address(atk), PRICE);
        // a second honest order so there is other money in the contract to steal
        vm.prank(merchant);
        checkout.createOrder(keccak256("other"), 5 ether);
        vm.prank(bob);
        checkout.pay{value: 5 ether}(keccak256("other"));

        atk.buy(ID, PRICE, 3);
        atk.startRefund();

        assertEq(address(atk).balance, PRICE, "attacker got exactly its own money");
        assertEq(address(checkout).balance, 5 ether, "other escrow untouched");
        assertEq(atk.blocked(), 3, "every re-entry reverted");
    }

    function test_RefundOnlyBeforeRelease() public {
        vm.prank(alice);
        checkout.pay{value: PRICE}(ID);
        vm.prank(merchant);
        checkout.release(ID);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Checkout.WrongState.selector, ID, Checkout.State.Released));
        checkout.refund(ID);

        // and the reverse: a refunded order cannot be released
        bytes32 id2 = keccak256("order-2");
        vm.prank(merchant);
        checkout.createOrder(id2, PRICE);
        vm.prank(alice);
        checkout.pay{value: PRICE}(id2);
        vm.prank(alice);
        checkout.refund(id2);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(Checkout.WrongState.selector, id2, Checkout.State.Refunded));
        checkout.release(id2);
    }

    // ---- extra fuzz coverage ----

    /// Any msg.value other than the price is rejected and moves no money.
    function testFuzz_WrongAmountPaymentReverts(uint96 sent) public {
        vm.assume(uint256(sent) != PRICE);
        vm.deal(alice, uint256(sent));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Checkout.WrongAmount.selector, PRICE, uint256(sent)));
        checkout.pay{value: sent}(ID);
        assertEq(address(checkout).balance, 0);
        (,, Checkout.State s) = checkout.orders(ID);
        assertEq(uint8(s), uint8(Checkout.State.Created));
    }

    function test_RevertWhen_PayUnknownOrder() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Checkout.WrongState.selector, keccak256("nope"), Checkout.State.None));
        checkout.pay{value: 1}(keccak256("nope"));
    }

    /// Releasing twice never credits the merchant twice, whatever the price.
    function testFuzz_DoubleReleaseCreditsOnce(uint96 price, uint8 extraCalls) public {
        price = uint96(bound(price, 1, 1_000 ether));
        extraCalls = uint8(bound(extraCalls, 1, 5));
        bytes32 id = keccak256(abi.encode("dr", price));
        vm.deal(alice, uint256(price));
        vm.prank(merchant);
        checkout.createOrder(id, price);
        vm.prank(alice);
        checkout.pay{value: price}(id);

        vm.startPrank(merchant);
        checkout.release(id);
        for (uint256 i; i < extraCalls; i++) {
            vm.expectRevert(abi.encodeWithSelector(Checkout.WrongState.selector, id, Checkout.State.Released));
            checkout.release(id);
        }
        vm.stopPrank();
        assertEq(checkout.pending(merchant), price);
    }

    /// Fuzzed re-entry depth and price: attacker never receives more than it paid.
    function testFuzz_ReentrantRefundNeverOverpays(uint96 price, uint8 depth) public {
        price = uint96(bound(price, 1, 100 ether));
        depth = uint8(bound(depth, 1, 8));
        bytes32 id = keccak256(abi.encode("re", price, depth));
        vm.prank(merchant);
        checkout.createOrder(id, price);
        bytes32 honest = keccak256("honest");
        vm.prank(merchant);
        checkout.createOrder(honest, 7 ether);
        vm.prank(bob);
        checkout.pay{value: 7 ether}(honest);

        ReentrantBuyer atk = new ReentrantBuyer(checkout);
        vm.deal(address(atk), uint256(price));
        atk.buy(id, price, depth);
        atk.startRefund();

        assertEq(address(atk).balance, uint256(price));
        assertEq(address(checkout).balance, 7 ether);
        assertEq(atk.blocked(), depth);
    }

    /// Only the payer or the merchant may refund; funds always go to the payer.
    function test_RevertWhen_StrangerRefunds() public {
        vm.prank(alice);
        checkout.pay{value: PRICE}(ID);
        vm.prank(bob);
        vm.expectRevert(Checkout.NotAuthorised.selector);
        checkout.refund(ID);
        uint256 before = alice.balance;
        vm.prank(merchant);
        checkout.refund(ID);
        assertEq(alice.balance - before, PRICE);
    }

    function test_RevertWhen_NonMerchantCreatesOrder() public {
        vm.prank(alice);
        vm.expectRevert(Checkout.NotMerchant.selector);
        checkout.createOrder(keccak256("x"), 1);
    }

    function test_RevertWhen_OrderCreatedTwiceOrZeroPrice() public {
        vm.startPrank(merchant);
        vm.expectRevert(abi.encodeWithSelector(Checkout.WrongState.selector, ID, Checkout.State.Created));
        checkout.createOrder(ID, 2 ether);
        vm.expectRevert(Checkout.ZeroPrice.selector);
        checkout.createOrder(keccak256("free"), 0);
        vm.stopPrank();
    }

    function test_RevertWhen_WithdrawNothing() public {
        vm.prank(merchant);
        vm.expectRevert(Checkout.NothingToWithdraw.selector);
        checkout.withdraw();
    }

    /// Plain ETH transfers (no order id) are rejected.
    function test_RevertWhen_PlainTransfer() public {
        vm.prank(alice);
        (bool ok,) = address(checkout).call{value: 1 ether}("");
        assertFalse(ok);
    }
}
