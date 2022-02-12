from django.db import models

# Create your models here.
class Product(models.Model):
    name =models.CharField(max_length=100)
    description =models.CharField(max_length=500, blank=True)
    created = models.DateTimeField(auto_now_add=True) #one initial timestamp
    updated = models.DateTimeField(auto_now=True) #after every update

    def __str__(self):
        return self.name+"--"+self.description

class Signal(models.Model):
    name=models.CharField(max_length=100)
    description=models.CharField(max_length=200)
    date=models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name+"--"+self.description+"--"+str(self.date)

