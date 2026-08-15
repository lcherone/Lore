<?php

declare(strict_types=1);

namespace Fixture\Tax;

use Fixture\Tax\Avalara\AvalaraTransactionMapper;

final class CreateTaxTransaction
{
    public function __construct(private AvalaraTransactionMapper $mapper) {}

    public function create(string $orderId, array $from, array $to): array
    {
        return $this->mapper->mapAddresses($orderId, $from, $to);
    }
}
