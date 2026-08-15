<?php

declare(strict_types=1);

namespace Fixture\Tests\Tax;

final class RefundTaxTransactionTest
{
    public function testRefundKeepsShipFromAndShipToDistinct(): void
    {
        \Fixture\Tax\Avalara\AddressCode::fromRole('ShipFrom', 'refund-100');
        \Fixture\Tax\Avalara\AddressCode::fromRole('ShipTo', 'refund-100');
    }
}
