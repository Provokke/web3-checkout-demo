// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Checkout
/// @notice Minimal ETH escrow for a single merchant. UNAUDITED demo code, never deployed to a live chain.
/// @dev Flow: merchant createOrder -> buyer pay (exact price) -> merchant release (credits a pull-payment
///      balance the merchant withdraws) or payer/merchant refund (before release only, pushes to payer).
contract Checkout {
    enum State {
        None,
        Created,
        Paid,
        Released,
        Refunded
    }

    struct Order {
        uint256 price;
        address payer;
        State state;
    }

    address public immutable merchant;
    mapping(bytes32 => Order) public orders;
    /// @notice Pull-payment balances (merchant proceeds after release).
    mapping(address => uint256) public pending;

    uint256 private _lock = 1;

    event OrderCreated(bytes32 indexed orderId, uint256 price);
    event Paid(bytes32 indexed orderId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed orderId, uint256 amount);
    event Refunded(bytes32 indexed orderId, address indexed payer, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotMerchant();
    error NotAuthorised();
    error ZeroPrice();
    error ZeroAddress();
    error WrongState(bytes32 orderId, State actual);
    error WrongAmount(uint256 expected, uint256 sent);
    error NothingToWithdraw();
    error TransferFailed();
    error Reentrancy();

    modifier onlyMerchant() {
        if (msg.sender != merchant) revert NotMerchant();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address merchant_) {
        if (merchant_ == address(0)) revert ZeroAddress();
        merchant = merchant_;
    }

    function createOrder(bytes32 orderId, uint256 price) external onlyMerchant {
        if (price == 0) revert ZeroPrice();
        Order storage o = orders[orderId];
        if (o.state != State.None) revert WrongState(orderId, o.state);
        o.price = price;
        o.state = State.Created;
        emit OrderCreated(orderId, price);
    }

    function pay(bytes32 orderId) external payable {
        Order storage o = orders[orderId];
        if (o.state != State.Created) revert WrongState(orderId, o.state);
        if (msg.value != o.price) revert WrongAmount(o.price, msg.value);
        o.payer = msg.sender;
        o.state = State.Paid;
        emit Paid(orderId, msg.sender, msg.value);
    }

    /// @notice Merchant accepts the order; proceeds become withdrawable (no ETH is sent here).
    function release(bytes32 orderId) external onlyMerchant {
        Order storage o = orders[orderId];
        if (o.state != State.Paid) revert WrongState(orderId, o.state);
        o.state = State.Released;
        pending[merchant] += o.price;
        emit Released(orderId, o.price);
    }

    /// @notice Return funds to the payer. Payer or merchant may call; funds always go to the payer.
    function refund(bytes32 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (o.state != State.Paid) revert WrongState(orderId, o.state);
        if (msg.sender != o.payer && msg.sender != merchant) revert NotAuthorised();
        o.state = State.Refunded;
        address payer = o.payer;
        uint256 amount = o.price;
        emit Refunded(orderId, payer, amount);
        _send(payer, amount);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pending[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pending[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        _send(msg.sender, amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
