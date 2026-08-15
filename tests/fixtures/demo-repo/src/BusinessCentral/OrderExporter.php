<?php

declare(strict_types=1);

namespace Fixture\BusinessCentral;

use Fixture\Order\Order;

final class OrderExporter
{
    public function export(Order $order): array
    {
        return ['delivery_address' => $order->getDeliveryAddress()];
    }
}
