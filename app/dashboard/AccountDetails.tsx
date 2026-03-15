"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserCircle } from "lucide-react";

export default function AccountDetails() {
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <UserCircle className="w-5 h-5" />
            ACCOUNT DETAILS
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Badge variant="success" className="font-semibold">
              Connected
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold">User ID: SUR-1234X</span>
            <Button variant="destructive" size="sm">
              DISCONNECT
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <Separator />
        
        <div className="space-y-2">
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-sm font-medium">Available Cash</span>
            <span className="text-sm font-bold text-green-600">₹95,000</span>
          </div>
          
          <div className="flex justify-between items-center py-2 border-b">
            <span className="text-sm font-medium">Margin Used</span>
            <span className="text-sm font-bold text-orange-600">₹12,500</span>
          </div>
          
          <div className="flex justify-between items-center py-2">
            <span className="text-sm font-medium">Available to Trade</span>
            <span className="text-sm font-bold text-blue-600">₹82,500</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
