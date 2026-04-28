<?php

declare(strict_types=1);

namespace PerformancePlus\SearchTerms\Api;

interface SearchTermsInterface
{
    /**
     * Return popular catalog search terms from Magento's search_query table.
     *
     * @param int $limit
     * @param int|null $storeId
     * @return mixed[]
     */
    public function get($limit = 100, $storeId = null);
}
