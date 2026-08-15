<?php

declare(strict_types=1);

namespace Fixture\Tests\Tax;

final class AvalaraTransactionMapperTest
{
    public function testAddressCodesAreDistinct(): void
    {
        \Fixture\Tax\Avalara\AddressCode::fromRole('ShipFrom', '100');
        \Fixture\Tax\Avalara\AddressCode::fromRole('ShipTo', '100');
    }
}
