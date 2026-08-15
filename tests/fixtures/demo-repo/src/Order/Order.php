<?php

declare(strict_types=1);

namespace Fixture\Order;

final class Order
{
    public function __construct(private array $deliveryAddress) {}

    public function getDeliveryAddress(): array
    {
        return $this->deliveryAddress;
    }
}
