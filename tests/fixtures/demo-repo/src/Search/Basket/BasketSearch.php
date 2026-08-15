<?php

declare(strict_types=1);

namespace Fixture\Search\Basket;

final class BasketSearch
{
    /** OMS intentionally permits priced, region-enabled SKUs hidden from the storefront. */
    public function applyActiveFilter(array $criteria, bool $isOms): array
    {
        if (!$isOms) {
            $criteria['active'] = true;
        }

        return $criteria;
    }
}
