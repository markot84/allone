<?php

declare(strict_types=1);

namespace PerformancePlus\SearchTerms\Model;

use Magento\Framework\App\ResourceConnection;
use PerformancePlus\SearchTerms\Api\SearchTermsInterface;

class SearchTerms implements SearchTermsInterface
{
    private ResourceConnection $resource;

    public function __construct(ResourceConnection $resource)
    {
        $this->resource = $resource;
    }

    /**
     * @inheritdoc
     */
    public function get($limit = 100, $storeId = null)
    {
        $safeLimit = max(1, min(500, (int) $limit));
        $connection = $this->resource->getConnection();
        $table = $this->resource->getTableName('search_query');

        $select = $connection
            ->select()
            ->from(
                ['q' => $table],
                [
                    'query_text',
                    'popularity',
                    'num_results',
                    'store_id',
                    'updated_at',
                ]
            )
            ->where('q.query_text IS NOT NULL')
            ->where('q.query_text != ?', '')
            ->order('q.popularity DESC')
            ->limit($safeLimit);

        if ($storeId !== null && $storeId !== '') {
            $select->where('q.store_id = ?', (int) $storeId);
        }

        $rows = $connection->fetchAll($select);

        return [
            'items' => array_map(
                static function (array $row): array {
                    return [
                        'query_text' => (string) ($row['query_text'] ?? ''),
                        'popularity' => (int) ($row['popularity'] ?? 0),
                        'num_results' => (int) ($row['num_results'] ?? 0),
                        'store_id' => (int) ($row['store_id'] ?? 0),
                        'updated_at' => (string) ($row['updated_at'] ?? ''),
                    ];
                },
                $rows
            ),
        ];
    }
}
