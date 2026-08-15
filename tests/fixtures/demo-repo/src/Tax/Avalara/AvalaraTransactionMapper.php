<?php

declare(strict_types=1);

namespace Fixture\Tax\Avalara;

final class AvalaraTransactionMapper
{
    public function mapAddresses(string $orderId, array $shipFrom, array $shipTo): array
    {
        return [
            ['code' => AddressCode::fromRole('ShipFrom', $orderId), 'address' => $shipFrom],
            ['code' => AddressCode::fromRole('ShipTo', $orderId), 'address' => $shipTo],
        ];
    }
}
