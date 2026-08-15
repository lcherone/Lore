<?php

declare(strict_types=1);

namespace Fixture\Tax\Avalara;

final class AddressCode
{
    public static function fromRole(string $role, string $orderId): string
    {
        return sprintf('%s-%s', $orderId, strtolower($role));
    }
}
