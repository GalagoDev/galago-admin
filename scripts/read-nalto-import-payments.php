<?php
declare(strict_types=1);

// CLI-only, SELECT-only bridge on the shared host. No public endpoint or Nalto writes.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
try {
    $app = getenv('NALTO_APP_PATH') ?: '';
    $companyId = getenv('NALTO_COMPANY_ID') ?: '';
    if ($app === '' || $app[0] !== '/' || !preg_match('/^[a-zA-Z0-9-]{1,64}$/D', $companyId)) throw new RuntimeException('Configuration');
    $config = require rtrim($app, '/') . '/config.php';
    $db = new PDO($config['dsn'], $config['user'] ?? '', $config['password'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 15,
    ]);
    if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
        $db->exec('SET NAMES utf8mb4');
        $db->exec('SET TRANSACTION READ ONLY');
    } else $db->exec('PRAGMA query_only=ON');
    $db->beginTransaction();
    $query = function(string $sql, array $args) use ($db): PDOStatement {
        $statement = $db->prepare($sql); $statement->execute($args); return $statement;
    };
    $company = $query('SELECT id,name FROM companies WHERE id=?', [$companyId])->fetch();
    if (!$company) throw new RuntimeException('Company');
    $range = $query('SELECT MIN(statement_date) AS first_date,MAX(statement_date) AS last_date FROM finance_statements WHERE company_id=?', [$companyId])->fetch();
    $rows = $query("SELECT t.id,t.transaction_date,t.partner,t.reference,t.amount,a.name AS account_name,a.currency,
        s.number AS statement_number,s.file_id,m.category
        FROM finance_transactions t
        JOIN finance_statements s ON s.id=t.statement_id AND s.company_id=t.company_id
        JOIN finance_accounts a ON a.id=s.account_id AND a.company_id=t.company_id
        LEFT JOIN bank_transaction_meta m ON m.transaction_id=t.id AND m.company_id=t.company_id
        WHERE t.company_id=? AND t.amount<0 AND (
          UPPER(t.partner) LIKE '%TADEX%' OR UPPER(t.reference) LIKE '%TADEX%'
          OR UPPER(t.partner) LIKE '%SHENGFENG%' OR UPPER(t.reference) LIKE '%SHENGFENG%'
          OR a.name LIKE '%53201200' OR a.name LIKE '%53201300'
        ) ORDER BY t.transaction_date,t.id", [$companyId])->fetchAll();
    if (count($rows) > 20000) throw new RuntimeException('Limit');
    $payments = [];
    $documentIds = [];
    foreach ($rows as $row) {
        $description = strtoupper($row['partner'] . ' ' . $row['reference']);
        $tadex = (bool)preg_match('/\bTADEX\b/', $description);
        $shengfeng = (bool)preg_match('/\bSHENGFENG\b/', $description);
        $supplier = $tadex === $shengfeng ? null : ($tadex ? 'TADEX' : 'SHENGFENG');
        $fee = $row['category'] === 'BANK_FEE' || preg_match('/PROVIZIJ|NAKNAD|BANK.*FEE|TROSKOVI INO BANKE/', $description);
        // Principal funding on account 50 and FX purchases are not a second supplier payment.
        if ($row['category'] === 'TRANSFER' || preg_match('/KUPOPRODAJ|FX SPOT|PRENOS.*VLASTIT|PRENOS.*SOPSTVEN|KONVERZIJA VALUTE/', $description)) continue;
        if ($fee && !$supplier) continue;
        $payments[] = [
            'id' => $row['id'], 'date' => $row['transaction_date'], 'partner' => $row['partner'],
            'reference' => $row['reference'], 'amountMinor' => abs((int)$row['amount']),
            'currency' => $row['currency'], 'kind' => $fee ? 'fee' : 'payment', 'supplier' => $supplier,
            'statement' => $row['statement_number'], 'account' => $row['account_name'], 'fileId' => $row['file_id'],
        ];
        if (!$supplier && !$fee && $row['file_id']) $documentIds[$row['file_id']] = true;
    }
    $documents = [];
    $known = json_decode(getenv('NALTO_KNOWN_DOCUMENTS') ?: '{}', true, 512, JSON_THROW_ON_ERROR);
    foreach (array_keys($documentIds) as $id) {
        $meta = $query('SELECT id,sha256 FROM finance_files WHERE id=? AND company_id=?', [$id,$companyId])->fetch();
        if ($meta && isset($known[$id]) && $known[$id] === $meta['sha256']) { $documents[] = $meta + ['content'=>null]; continue; }
        $file = $query('SELECT id,sha256,content FROM finance_files WHERE id=? AND company_id=?', [$id,$companyId])->fetch();
        if (!$file || strlen($file['content']) > 14 * 1024 * 1024) throw new RuntimeException('Statement file');
        $documents[] = $file;
    }
    $db->commit();
    echo json_encode(['companyId' => $company['id'], 'companyName' => $company['name'],
        'sourceFrom' => $range['first_date'], 'sourceThrough' => $range['last_date'], 'payments' => $payments, 'documents' => $documents], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (Throwable $error) {
    fwrite(STDERR, "Nalto payment source unavailable.\n");
    exit(1);
}
